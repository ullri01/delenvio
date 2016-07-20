var AWS = require('aws-sdk')
var cfg = require('./config')
var Logger = require('./logger')

AWS.config.region = cfg.region
var db = new AWS.DynamoDB()
var logger = new Logger(cfg.logLevel)

exports.handler = function (event, context, cb) {
  function succeed (start, recordCount) {
    logger.info('lambda succeeded')
    if (cb) cb()
    context.done(null, {"Hello":"World"})
  }

  function fail (e) {
    logger.error('Catalog failed!', e, e.stack)
    if (cb) cb()
    context.done(null, {"Hello":"World"})
  }

  try {
    var index = context.functionName.lastIndexOf('-')
    var env = index !== -1 ? context.functionName.substring(index + 1) : 'dev'
    var config = cfg[env]
  }
  catch
  (e) {
    fail(e)
  }
}
