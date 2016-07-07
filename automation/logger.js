module.exports = function (level) {
  var levelValue = 100
  switch (level) {
    case 'TRACE':
      levelValue = 0
      break
    case 'DEBUG':
      levelValue = 1
      break
    case 'INFO':
      levelValue = 2
      break
    case 'WARN':
      levelValue = 3
      break
    case 'ERROR':
      levelValue = 4
      break
    case 'FATAL':
      levelValue = 5
      break
  }

  if (process.argv.join('').indexOf(' mocha') > -1) {
    levelValue = 100
  }

  return {
    str: function (name, args) {
      var values = [new Date().toISOString(), name]
      var type, val

      for (var i = 0; i < args.length; i++) {
        type = typeof args[i]
        val = (type === 'object') ? JSON.stringify(args[i]) : args[i]

        if (type !== 'undefined') {
          values.push(val)
        }
      }
      return values.join(' ')
    },
    trace: function () {
      if (levelValue <= 0) {
        console.log(this.str('TRACE:', arguments))
      }
    },
    debug: function (message) {
      if (levelValue <= 1) {
        console.log(this.str('DEBUG:', arguments))
      }
    },
    info: function (message) {
      if (levelValue <= 2) {
        console.log(this.str('INFO:', arguments))
      }
    },
    log: function (message) {
      if (levelValue <= 2) {
        console.log(this.str('INFO:', arguments))
      }
    },
    warn: function (message) {
      if (levelValue <= 3) {
        console.log(this.str('WARN:', arguments))
      }
    },
    error: function (message) {
      if (levelValue <= 4) {
        console.log(this.str('ERROR:', arguments))
      }
    },
    fatal: function (message) {
      if (levelValue <= 5) {
        console.log(this.str('FATAL:', arguments))
      }
    }
  }
}
