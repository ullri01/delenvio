#! /usr/bin/env node
var env = (process.env.NODE_ENV || 'dev')
if (require.main === module && process.argv[4]) {
  env = process.argv[4]
}

var path = require('path')
var config = require(path.join(__dirname, '/config'))[env]
var Promise = require('bluebird')
var AWS = require('aws-sdk')
var Logger = require(path.join(__dirname, '/logger'))

if (config.profile) {
  AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: config.profile})
}
AWS.config.region = config.region
var lambda = new AWS.Lambda({region: config.region})
var events = new AWS.CloudWatchEvents()
var logger = new Logger(config.logLevel)

function updateEventSource (functionName, enabled) {
  var isEnabled = (enabled === undefined) ? true : enabled
  return lambda.listEventSourceMappings({FunctionName: functionName}).promise().catch(function (error) {
    logger.error('ERROR', 'listEventSources', error)
  }).then(function (sources) {
    Promise.map(sources.EventSourceMappings, function (source) {
      var params = {UUID: source.UUID, Enabled: isEnabled, FunctionName: functionName}
      lambda.updateEventSourceMapping(params).promise().catch(function (err) {
        logger.error('updateEventSourceMapping', err)
      }).then(function (data) {
        logger.info('updateEventSourceMapping ' + functionName + ' enabled: ' + isEnabled)
        return Promise.resolve(data)
      })
    })
  })
}

if (require.main === module) {
  var option = process.argv[2]
  var state = process.argv[3]
  console.log("Environment=", env)
  if (state === '-resume' || state === '-pause') {
    state = state === '-pause'
  } else {
    option = ''
  }
  switch (option) {
    case '-all':
      Promise.join(
      updateEventSource(config.lambda.lambda + '-' + env, state),
      function () {
      }
      )
      break
    case '-lambda':
      updateEventSource(config.lambda.lambda + '-' + env, state)
      break
    default:
      logger.info('./control.js -all|-lambda -resume|-pause ')
  }
}
