var level, ref, timestamp, winston;

winston = require("winston");

level = "info";

if ((ref = process.env.DEBUG) === "1" || ref === "true") {
  level = "debug";
}

timestamp = false;

if (process.env.NODE_ENV === "production") {
  timestamp = true;
}

module.exports = new winston.Logger({
  transports: [
    new winston.transports.Console({
      timestamp: timestamp,
      colorize: true,
      level: level,
      label: "redis-port"
    })
  ]
});
