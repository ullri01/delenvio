#! /usr/bin/env node
var env = (process.env.NODE_ENV || 'dev')
if (require.main === module && process.argv[2]) {
  env = process.argv[2]
}
var path = require('path')
var ld = require('lodash')
var template = require(path.join(__dirname, '/template.json'))
var deployer = require(path.join(__dirname, '/deploy.js'))
var config = require(path.join(__dirname, '/config'))[env]
var Promise = require('bluebird')
var AWS = require('aws-sdk')
var Logger = require(path.join(__dirname, '/logger'))

if (config.profile) {
  AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: config.profile})
}
AWS.config.region = config.region
var s3 = new AWS.S3()
var logs = new AWS.CloudWatchLogs()
var cf = new AWS.CloudFormation()
var lambda = new AWS.Lambda()
var db = new AWS.DynamoDB()
var logger = new Logger(config.logLevel)

function getStack (name) {
  var params = {}

  return new Promise(function (resolve, reject) {
    cf.listStacks(params, function (err, data) {
      if (err) {
        logger.error(err, err.stack)
        reject(err)
      } else {
        var stack = null
        data.StackSummaries.forEach(function (s) {
          if (s.StackName === name && s.StackStatus !== 'DELETE_COMPLETE') {
            stack = s
          }
        })
        resolve(stack)
      }
    })
  })
}

function describeStack (name) {
  var params = {
    StackName: name
  }
  return new Promise(function (resolve, reject) {
    cf.describeStackEvents(params, function (err, data) {
      if (err) {
        logger.error(err)
        resolve(err)
      } else {
        resolve(data.StackEvents[0])
      }
    })
  })
}

function deleteStack (name) {
  var params = {
    StackName: name,
    RetainResources: []
  }
  return new Promise(function (resolve, reject) {
    cf.deleteStack(params, function (err, data) {
      if (err) {
        logger.error(err)
      } else {
        logger.info(data)
        waitFor(name, 'stackDeleteComplete', resolve)
      }
    })
  })
}

function waitFor (name, state, resolve, reject) {
  cf.waitFor(state, {StackName: name}, function (err, data) {
    if (err) {
      describeStack(name).then(function (data) {
        logger.info('Wait for stack:', err.message, data.ResourceStatus)
      })
    }
    resolve(data)
  })
}

function createStack (identifier, template) {
  logger.info('Create stack:', identifier)

  var paramValues = {
    env: env,
    lambdaName: config.lambda.lambda,
    alarmsEmail: config.alarmsEmail
  }
  var parameters = []
  for (var key in paramValues) {
    parameters.push({ParameterKey: key, ParameterValue: paramValues[key]})
  }

  var options = {
    StackName: identifier,
    Capabilities: ['CAPABILITY_IAM'],
    Parameters: parameters,
    OnFailure: 'DO_NOTHING',
    Tags: [{Key: config.stackTagName, Value: config.stackTagValue}],
    TemplateBody: JSON.stringify(template),
    TimeoutInMinutes: 10
  }

  return new Promise(function (resolve, reject) {
    cf.createStack(options, function (err, data) {
      if (err) {
        if (err.code !== 'AlreadyExistsException') {
          logger.error(err)
          resolve(err)
        }
      } else {
        waitFor(identifier, 'stackCreateComplete', resolve)
      }
    })
  })
}

function updateStack (identifier, template) {
  logger.info('Update stack:', identifier)
  var paramValues = {
    env: env,
    lambdaName: config.lambda.lambda,
    alarmsEmail: config.alarmsEmail
  }
  var parameters = []
  for (var key in paramValues) {
    parameters.push({ParameterKey: key, ParameterValue: paramValues[key]})
  }

  var options = {
    StackName: identifier,
    Capabilities: ['CAPABILITY_IAM'],
    Parameters: parameters,
    Tags: [{Key: config.stackTagName, Value: config.stackTagValue}],
    TemplateBody: JSON.stringify(template)
  }

  return new Promise(function (resolve, reject) {
    cf.updateStack(options, function (err, data) {
      if (err) {
        if (err.code === 'ValidationError' && err.message.startsWith('No updates')) {
          logger.error(err)
          resolve(err.message)
        } else {
          logger.info(err)
          reject(err)
        }
      } else {
        waitFor(identifier, 'stackUpdateComplete', resolve)
      }
    })
  })
}

function createOrUpdateStack (identifier, template) {
  return getStack(identifier, template).then(function (stack) {
    if (!stack) {
      return createStack(identifier, template)
    } else {
      if (stack.StackStatus === 'ROLLBACK_COMPLETE') {
        return deleteStack(identifier).then(function (data) {
          return createStack(identifier, template)
        })
      } else {
        return updateStack(identifier, template)
      }
    }
  })
}

function deployLambdaFunctions () {
  logger.info('deployLambdaFunctions ...')
  return Promise.join(
  Promise.map(ld.keys(config.lambda), function(lambda){
    return deployer.zipLambda(lambda)
  }),
  function () {
    return Promise.join(
    Promise.map(ld.keys(config.lambda), function(lambda){
      return deployer.deployLambdaZipToS3(lambda)
    }),
    function () {
      var locations = []
      for (var i = 0; i < arguments.length; i++) {
        locations.push(arguments[i].Location)
      }
      return locations
    })
  }).catch(function(e){
    logger.error(e.message, e.stack)
  })
}

function getLambdaFunction (functionName) {
  return new Promise(function (resolve, reject) {
    lambda.getFunction({FunctionName: functionName}, function (err, data) {
      if (err) {
        logger.error('getFunction', err, data)
        resolve(data)
      } else {
        resolve(data)
      }
    })
  })
}

function createLambdaLogGroups () {
  logger.info('createLambdaLogGroups ...')
  var promises = []

  for (var lambda in config.lambda) {
    var name = '/aws/lambda/' + config.lambda[lambda] + '-' + env
    var p = logs.createLogGroup({logGroupName: name}).promise().catch(function (e) {
      if (e.code !== 'ResourceAlreadyExistsException') {
        logger.error('createLogGroup', e)
      }
    })
    promises.push(p)
  }

  return Promise.all(promises).then(function (data) {
    promises = []
    for (var lambda in config.lambda) {
      var name = '/aws/lambda/' + config.lambda[lambda] + '-' + env
      var params = {logGroupName: name, retentionInDays: config.cloudwatch.retentionInDays}

      var p = logs.putRetentionPolicy(params).promise().catch(function (e) {
        logger.error('putRetentionPolicy', e)
      })
      promises.push(p)
    }
    return Promise.all(promises).then(function (data) {
      return data
    })
  }).catch(function (e) {
    if (e.code !== 'ResourceAlreadyExistsException') {
      logger.error('createLambdaLogGroups', e)
    }
  })
}

function createBucket () {
  logger.info('createBucket ...')
  return new Promise(function (resolve, reject) {
    var params = {Bucket: config.s3.bucket}

    s3.headBucket(params, function (err, data) {
      if (err && err.code === 'NotFound') {
        var params = {Bucket: config.s3.bucket}

        s3.createBucket(params, function (err, data) {
          if (err) reject(err)
          else resolve(data.Location)
        })
      } else if (err) reject(err)
      else resolve(data)
    })
  })
}


function runAutomation () {
  var output = {}

  return createBucket().then(function () {
    return deployLambdaFunctions()
  }).then(function () {
    return createLambdaLogGroups()
  }).then(function () {
    return createOrUpdateStack(config.stackName + '-' + env, template)
  }).then(function (data) {
    if (data && data.Stacks) {
      data.Stacks[0].Outputs.forEach(function (out) {
        output[out.OutputKey] = out.OutputValue
      })
    }
    logger.info('Output', output)
  })
}

logger.info('ENV', env)
runAutomation()
