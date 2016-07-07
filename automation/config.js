var config = {}
config.region = 'us-east-1'
config.logLevel = 'INFO'

function clone (a) {
  return JSON.parse(JSON.stringify(a))
}

config.dev = {
  profile: 'trally',
  logLevel: config.logLevel,
  region: config.region,
  alarmsEmail: 'info@wheel42.com',
  stackName: 'delenvio',

  lambda: {
    lambda: 'WebLambda'
  },

  cloudwatch: {
    retentionInDays: 30
  },

  s3: {
    bucket: 'com.delenvio.bucket.storage.dev',
    deploy: 'deploy/'
  }
}
config.test = clone(config.dev)
config.stage = clone(config.dev)
config.qa = clone(config.dev)
config.qa.s3.bucket = 'com.delenvio.bucket.storage.qa'
config.prod = clone(config.dev)
config.prod.s3.bucket = 'com.delenvio.bucket.storage.prod'
config.local = clone(config.dev)
config.local.endpoint = 'http://localhost:8000'

module.exports = config
