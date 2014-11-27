var EventEmitter, RedisPort, assert, async, log, path, redis, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

assert = require("assert");

async = require("async");

EventEmitter = require("events").EventEmitter;

path = require("path");

redis = require("redis");

_ = require("underscore");

log = require("./log");

RedisPort = (function(_super) {
  __extends(RedisPort, _super);

  RedisPort.prototype.client = null;

  RedisPort.prototype.ephemerals = {};

  RedisPort.prototype.ephemeralExpire = 15000;

  RedisPort.prototype.ephemeralRefresh = 10000;

  RedisPort.prototype.prefix = "redis-port";

  RedisPort.prototype.rootPath = null;

  RedisPort.prototype.servicesPath = "services";

  RedisPort.prototype.subscriber = null;

  RedisPort.prototype.subscriptions = {};

  function RedisPort(options) {
    var attr, _i, _len, _ref;
    this.redisHost = options.redisHost, this.redisPort = options.redisPort, this.host = options.host, this.env = options.env, this.project = options.project;
    _ref = ["redisHost", "redisPort", "env", "host", "project"];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      attr = _ref[_i];
      assert(this[attr], "`" + attr + "` is required");
    }
    this.ephemeralExpire = options.ephemeralExpire || this.ephemeralExpire;
    this.ephemeralRefresh = options.ephemeralRefresh || this.ephemeralRefresh;
    this.prefix = options.prefix || this.prefix;
    this.rootPath = "/" + this.prefix + "/" + this.project + "/" + this.env;
  }

  RedisPort.prototype.start = function(cb) {
    log.debug("redis-port: Connecting to " + this.redisHost + ":" + this.redisPort);
    this.subscriber = redis.createClient(this.redisPort, this.redisHost, {
      retry_max_delay: 10000
    });
    this.subscriber.on("pmessage", (function(_this) {
      return function(pattern, channel, key) {
        var sub;
        log.debug("pmessage", pattern, key);
        sub = _this.subscriptions[pattern];
        if (!sub) {
          return log.debug("No subscription for " + pattern);
        }
        switch (key) {
          case "set":
            return _this.get(sub.path, function(error, service) {
              if (error) {
                return log.error("redis-port: Get error " + error.message);
              }
              sub.fn(service);
              return _this.emit("register", service);
            });
          case "expired":
            return _this.emit("free", sub.role);
        }
      };
    })(this));
    this.subscriber.on("error", (function(_this) {
      return function(error) {
        log.warn("redis-port: Redis client error: " + error.message);
        return _this.emit("reconnect");
      };
    })(this));
    this.client = redis.createClient(this.redisPort, this.redisHost, {
      retry_max_delay: 10000
    });
    this.client.once("connect", (function(_this) {
      return function(error) {
        log.debug("redis-port: Connected.");
        _this.emit("started");
        return typeof cb === "function" ? cb() : void 0;
      };
    })(this));
    return this.client.on("error", (function(_this) {
      return function(error) {
        log.warn("redis-port: Redis client error: " + error.message);
        return _this.emit("reconnect");
      };
    })(this));
  };

  RedisPort.prototype.stop = function() {
    this.client.quit();
    this.subscriber.quit();
    return this.emit("stopped");
  };

  RedisPort.prototype.pset = function(p, data, cb) {
    p = this._cleanPath(p);
    return this.client.set(p, JSON.stringify(data), function(error, result) {
      log.debug("set", p, result);
      if (error) {
        return cb(error);
      }
      return cb();
    });
  };

  RedisPort.prototype.mpset = function(arr, cb) {
    if (!Array.isArray(arr)) {
      return cb(new Error("No 2D array"));
    }
    if (arr.length && !Array.isArray(arr[0])) {
      return cb(new Error("No 2D array"));
    }
    return async.each(arr, ((function(_this) {
      return function(a, cb) {
        return _this.pset(a[0], a[1], cb);
      };
    })(this)), cb);
  };

  RedisPort.prototype.get = function(p, cb) {
    p = this._cleanPath(p);
    return this.client.get(p, function(error, data) {
      log.debug("get", p);
      if (error) {
        return cb(error);
      }
      return cb(null, JSON.parse(data));
    });
  };

  RedisPort.prototype.del = function(p, cb) {
    p = this._cleanPath(p);
    return this.client.keys("" + p + "*", (function(_this) {
      return function(error, keys) {
        log.debug("keys", "" + p + "*", keys);
        if (error) {
          return cb(error);
        }
        return async.eachSeries(keys, (function(k, cb) {
          clearTimeout(_this.ephemerals[k]);
          return _this.client.del(k, function(error, result) {
            log.debug("del", k, result);
            if (error) {
              return cb(error);
            }
            return cb();
          });
        }), function(error) {
          if (error) {
            return cb(error);
          }
          return cb();
        });
      };
    })(this));
  };

  RedisPort.prototype.mdel = function(keys, cb) {
    if (!Array.isArray(keys)) {
      return cb(new Error("No array"));
    }
    return async.each(keys, ((function(_this) {
      return function(key, cb) {
        return _this.del(key, cb);
      };
    })(this)), cb);
  };

  RedisPort.prototype.set = function(p, data, cb) {
    p = this._cleanPath(p);
    return this.client.psetex(p, this.ephemeralExpire, JSON.stringify(data), (function(_this) {
      return function(error, result) {
        var updateExpire;
        log.debug("setex", p, _this.ephemeralExpire);
        if (error) {
          return cb(error);
        }
        updateExpire = function() {
          return _this.client.pexpire(p, _this.ephemeralExpire, function(error, result) {
            log.debug("expire", p, result, _this.ephemeralRefresh);
            if (error) {
              return log.error("Error setting expire on " + p + ": " + error.message);
            }
            return _this.ephemerals[p] = setTimeout(updateExpire, _this.ephemeralRefresh);
          });
        };
        updateExpire();
        return cb();
      };
    })(this));
  };

  RedisPort.prototype.mset = function(arr, cb) {
    if (!Array.isArray(arr)) {
      return cb(new Error("No 2D array"));
    }
    if (arr.length && !Array.isArray(arr[0])) {
      return cb(new Error("No 2D array"));
    }
    return async.each(arr, ((function(_this) {
      return function(a, cb) {
        return _this.set(a[0], a[1], cb);
      };
    })(this)), cb);
  };

  RedisPort.prototype.list = function(p, cb) {
    p = this._cleanPath(p);
    return this.client.keys("" + p + "*", (function(_this) {
      return function(error, keys) {
        var key, ks, _i, _len;
        log.debug("keys", "" + p + "*", keys);
        if (error) {
          return cb(error);
        }
        ks = [];
        for (_i = 0, _len = keys.length; _i < _len; _i++) {
          key = keys[_i];
          ks.push(key.replace("" + _this.rootPath + "/", ""));
        }
        return cb(null, ks);
      };
    })(this));
  };

  RedisPort.prototype.register = function(role, cb) {
    var port;
    if (typeof role === 'object') {
      port = role.port;
      role = role.role;
    }
    return this.getPorts((function(_this) {
      return function(error, ports) {
        if (error) {
          return cb(error);
        }
        while ((port == null) || __indexOf.call(ports, port) >= 0) {
          port = 10000 + Math.floor(Math.random() * 55000);
        }
        return _this.set("services/" + role, {
          host: _this.host,
          port: port,
          role: role
        }, function(error, stat) {
          if (error) {
            return cb(error);
          }
          return cb(null, port);
        });
      };
    })(this));
  };

  RedisPort.prototype.query = function(role, fn) {
    var p, subscriptionKey;
    p = this._cleanPath("services/" + role);
    subscriptionKey = "__keyspace@0__:" + p;
    this.subscriber.psubscribe(subscriptionKey);
    log.debug("Subscribing to " + p);
    this.subscriptions[subscriptionKey] = {
      path: p,
      fn: fn,
      role: role
    };
    return this.get(p, (function(_this) {
      return function(error, service) {
        if (!error && service) {
          return fn(service);
        }
      };
    })(this));
  };

  RedisPort.prototype.getServices = function(cb) {
    return this.list(this.servicesPath, (function(_this) {
      return function(error, roles) {
        var services;
        if (error) {
          return cb(error);
        }
        services = [];
        return async.eachSeries(roles, (function(role, cb) {
          return _this.get(role, function(error, s) {
            if (error) {
              return cb(error);
            }
            services.push(s);
            return cb();
          });
        }), function(error) {
          if (error) {
            return cb(error);
          }
          return cb(null, services);
        });
      };
    })(this));
  };

  RedisPort.prototype.getPorts = function(cb) {
    return this.getServices((function(_this) {
      return function(error, services) {
        var ports;
        if (error) {
          return cb(error);
        }
        ports = _.chain(services).filter(function(s) {
          return s.host === _this.host;
        }).map(function(s) {
          return s.port;
        }).value();
        return cb(null, ports);
      };
    })(this));
  };

  RedisPort.prototype._cleanPath = function(p) {
    var resolvedPath;
    if (0 === p.indexOf(this.rootPath)) {
      return p;
    }
    return resolvedPath = path.resolve(this.rootPath, p);
  };

  return RedisPort;

})(EventEmitter);

module.exports = RedisPort;
