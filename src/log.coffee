winston = require "winston"

level = "info"
level = "debug" if process.env.DEBUG in ["1", "true"]

timestamp = false
timestamp = true if process.env.NODE_ENV is "production"

module.exports = new winston.Logger
	transports: [
		new winston.transports.Console
			timestamp: timestamp
			colorize:  true
			level:     level
			label:     "redis-port"
	]

