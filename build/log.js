var level, timestamp, winston, _ref;

winston = require("winston");

level = "info";

if ((_ref = process.env.DEBUG) === "1" || _ref === "true") {
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
      level: level
    })
  ]
});
