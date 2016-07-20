#! /usr/bin/env node
var env = (process.env.NODE_ENV || 'dev')
if (require.main === module && process.argv.length != 4) {
  console.info('USAGE: deploy [lambda] [dev|qa|prod]')
  process.exit(0)
}
if (require.main === module && process.argv[3]) {
  env = process.argv[2]
}
var Promise = require('bluebird')
var AWS = require('aws-sdk')
var config = require('./config')[env]
var fs = require('fs')
var path = require('path')
var exec = require('child_process').exec
var archiver = require('archiver')
var Logger = require(path.join(__dirname, '/logger'))

if (config.profile) {
  AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: config.profile})
}
AWS.config.region = config.region
var lambda = new AWS.Lambda()
var s3 = new AWS.S3()
var buildDir = path.join(__dirname, './.build/')
var logger = new Logger(config.logLevel)

function getIgnores (lambda) {
  var ignores = ['package.json', 'config.js', 'logger.js', 'node_modules/.bin/**', 'node_modules/**/*.md',
    'node_modules/**/LICENSE', 'node_modules/moment/locale/*', 'node_modules/moment/src/**']

  var packages = {}
  packages.lambda = ['archiver', 'archiver-utils', 'graceful-fs', 'lazystream', 'normalize-path', 'async', 'buffer-crc32',
    'glob', 'inflight', 'wrappy', 'inherits', 'minimatch', 'brace-expansion', 'balanced-match', 'concat-map', 'once',
    'readable-stream', 'core-util-is', 'isarray', 'process-nextick-args', 'string_decoder', 'util-deprecate', 'tar-stream',
    'bl', 'end-of-stream', 'xtend', 'zip-stream', 'compress-commons', 'crc32-stream', 'node-int64', 'sinon', 'formatio',
    'lolex', 'samsam', 'sinon-chai', 'proxyquire', 'resolve', 'merge-descriptors', 'is-object', 'nock', 'fill-keys', 'qs',
    'deep-equal', 'propagate', 'mocha', 'commander', 'debug', 'diff', 'escape-string-regexp', 'glob', 'graceful-fs', 'minimatch',
    'lru-cache', 'sigmund', 'growl', 'jade', 'mkdirp', 'minimist', 'supports-color', 'chai', 'assertion-error', 'type-detect',
    'deep-eql', 'aws-sdk', 'jmespath', 'sax', 'xml2js', 'xmlbuilder']

  packages[lambda].forEach(function (packageName) {
    ignores.push('node_modules/' + packageName + '/**')
  })
  return ignores
}

function zipLambda (lambda, lambdaName) {
  var packageZip = buildDir + lambdaName + '.zip'
  logger.info('Zipping', packageZip)

  return new Promise(function (resolve, reject) {
    var output = fs.createWriteStream(packageZip)
    var archive = archiver('zip')
    output.on('close', function () {
      logger.info(lambdaName, archive.pointer(), 'total bytes')
      resolve(packageZip)
    })

    archive.on('error', function (err) {
      logger.error(err)
    })

    archive.pipe(output)
    archive.glob('**/*', {cwd: path.join(__dirname, '..', lambda), ignore: getIgnores(lambda)}, {})
    archive.append(fs.createReadStream(path.join(__dirname, '/config.js')), {name: 'config.js'})
    archive.append(fs.createReadStream(path.join(__dirname, '/logger.js')), {name: 'logger.js'})
    archive.finalize()
  }).catch(function (e) {
    logger.error('zipLambda', e, e.stack)
  })
}

function deployLambdaZipToS3 (lambda, lambdaName) {
  var packageZip = buildDir + lambdaName + '.zip'
  logger.info('Uploading to S3', packageZip)

  return new Promise(function (resolve, reject) {
    var body = fs.createReadStream(packageZip)

    var params = {Bucket: config.s3.bucket, Key: config.s3.deploy + lambdaName + '.zip', Body: body}
    s3.upload(params).send(function (err, data) {
      if (err) {
        logger.error('UPLOAD TO S3: ', err)
        resolve(err)
      } else {
        resolve(data)
      }
    })
  }).catch(function (e) {
    logger.error(e, e.stack)
  })
}

function updateLambdaFunction (name, bucket, s3key) {
  var params
  return new Promise(function (resolve, reject) {
    lambda.getFunction({FunctionName: name}, function (err, data) {
      if (err) {
        logger.error('Function get: ', name, err, err.stack)
        reject(err)
      } else {
        params = {FunctionName: name, Publish: true, S3Bucket: bucket, S3Key: s3key}
        lambda.updateFunctionCode(params, function (err, funcData) {
          if (err) {
            logger.error('Function code update: ', err, err.stack)
            reject(err)
          } else {
            resolve(funcData)
          }
        })
      }
    })
  })
}

function deployLambdaFunction (dirName, lambdaName) {
  zipLambda(dirName, lambdaName).then(function (data) {
    return deployLambdaZipToS3(dirName, lambdaName)
  }).then(function (data) {
    return updateLambdaFunction(lambdaName, data.Bucket, data.Key)
  }).then(function (data) {
    logger.info('Lambda function:', data.FunctionArn)
  })
}

function deployStaticWebsite (sitePath, siteName, profile) {
  return new Promise(function (resolve, reject) {
    var profileOption = profile ? ' --profile ' + profile : ''
    var cmd = 'aws s3 cp' + profileOption + ' --recursive ' + sitePath + ' s3://' + siteName + '/'

    exec(cmd, {maxBuffer: 1024 * 3000},function (error, stdout, stderr) {
      if (error) {
        logger.error('Site deployment: ', error, stderr)
        reject(error)
      }
      else {
        resolve(stdout)
      }
    });
  }).then(function (data) {
    logger.info('Site deployed:', data)
  })
}

if (require.main === module) {
  var name = process.argv[3]
  if (name === 'website') {
    var site = (env === 'prod') ? config.site : env + '.' + config.site
    deployStaticWebsite(config.sitePath, site, config.profile)
  } else {
    var funcName = config.lambda.lambda + '-' + env
    logger.info('Deploying: ', funcName, env)
    deployLambdaFunction(name, funcName)
  }
} else {
  module.exports = {
    zipLambda: zipLambda,
    deployLambdaZipToS3: deployLambdaZipToS3
  }
}
