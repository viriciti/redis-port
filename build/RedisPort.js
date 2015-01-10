var EventEmitter, RedisPort, assert, async, log, path, redis, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

_ = require("underscore");

assert = require("assert");

async = require("async");

path = require("path");

redis = require("redis");

EventEmitter = require("events").EventEmitter;

log = require("./log");

RedisPort = (function(_super) {
  __extends(RedisPort, _super);

  RedisPort.prototype.client = null;

  RedisPort.prototype.ephemerals = null;

  RedisPort.prototype.ephemeralExpire = 15000;

  RedisPort.prototype.ephemeralRefresh = 10000;

  RedisPort.prototype.prefix = "redis-port";

  RedisPort.prototype.rootPath = null;

  RedisPort.prototype.servicesPath = "services";

  RedisPort.prototype.subscriber = null;

  RedisPort.prototype.subscriptions = null;

  RedisPort.prototype.wildcards = null;

  function RedisPort(options, id) {
    var attr, _i, _len, _ref;
    this.id = id;
    this.redisHost = options.redisHost, this.redisPort = options.redisPort, this.host = options.host, this.env = options.env, this.project = options.project;
    _ref = ["redisHost", "redisPort", "env", "host", "project"];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      attr = _ref[_i];
      assert(this[attr], "`" + attr + "` is required");
    }
    this.id || (this.id = Math.round(Math.random() * 10000));
    this.ephemeralExpire = options.ephemeralExpire || this.ephemeralExpire;
    this.ephemeralRefresh = options.ephemeralRefresh || this.ephemeralRefresh;
    this.prefix = options.prefix || this.prefix;
    this.rootPath = "/" + this.prefix + "/" + this.project + "/" + this.env;
  }

  RedisPort.prototype.start = function(cb) {
    log.debug("" + this.id + ": connecting to " + this.redisHost + ":" + this.redisPort);
    this.ephemerals = {};
    this.subscriptions = {};
    this.wildcards = {};
    this.subscriber = redis.createClient(this.redisPort, this.redisHost, {
      retry_max_delay: 10000
    });
    this.subscriber.on("pmessage", (function(_this) {
      return function(pattern, channel, key) {
        var serviceRole, sub, wildcard;
        log.debug("" + _this.id + ": pmessage", pattern, key);
        switch (key) {
          case "set":
            if (pattern.length - 1 === pattern.indexOf("*")) {
              wildcard = _this.wildcards[pattern];
              serviceRole = channel.replace("__keyspace@0__:", "");
              return _this.get(serviceRole, function(error, service) {
                if (error) {
                  return log.error("get error " + error.message);
                }
                return wildcard.fn(service);
              });
            } else {
              sub = _this.subscriptions[pattern];
              if (!sub) {
                return log.debug("" + _this.id + ": no subscription for " + pattern);
              }
              return _this.get(sub.path, function(error, service) {
                if (error) {
                  return log.error("get error " + error.message);
                }
                return sub.fn(service);
              });
            }
        }
      };
    })(this));
    this.subscriber.on("error", (function(_this) {
      return function(error) {
        log.warn("Redis client error: " + error.message);
        return _this.emit("reconnect");
      };
    })(this));
    this.client = redis.createClient(this.redisPort, this.redisHost, {
      retry_max_delay: 10000
    });
    this.client.once("connect", (function(_this) {
      return function(error) {
        log.debug("" + _this.id + ": Connected.");
        _this.emit("started");
        return typeof cb === "function" ? cb() : void 0;
      };
    })(this));
    return this.client.on("error", (function(_this) {
      return function(error) {
        log.warn("Redis client error: " + error.message);
        return _this.emit("reconnect");
      };
    })(this));
  };

  RedisPort.prototype.stop = function() {
    var p, timeout, _ref;
    log.debug("" + this.id + ": stopping");
    this.client.end();
    this.subscriber.end();
    _ref = this.ephemerals;
    for (p in _ref) {
      timeout = _ref[p];
      clearTimeout(timeout);
    }
    this.emit("stopped");
    return log.debug("" + this.id + ": stopped");
  };

  RedisPort.prototype.pset = function(p, data, cb) {
    p = this._cleanPath(p);
    return this.client.set(p, JSON.stringify(data), function(error, result) {
      log.debug("" + this.id + ": set", p, result);
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
    return this.client.get(p, (function(_this) {
      return function(error, data) {
        log.debug("" + _this.id + ": get", p);
        if (error) {
          return cb(error);
        }
        return cb(null, JSON.parse(data));
      };
    })(this));
  };

  RedisPort.prototype.del = function(p, cb) {
    p = this._cleanPath(p);
    return this.client.keys("" + p + "*", (function(_this) {
      return function(error, keys) {
        log.debug("" + _this.id + ": del keys", "" + p + "*", keys);
        if (error) {
          return cb(error);
        }
        return async.eachSeries(keys, (function(k, cb) {
          clearTimeout(_this.ephemerals[k]);
          return _this.client.del(k, function(error, result) {
            log.debug("" + _this.id + ": del", k, result);
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
        log.debug("" + _this.id + ": setex", p, _this.ephemeralExpire);
        if (error) {
          return cb(error);
        }
        updateExpire = function() {
          return _this.client.pexpire(p, _this.ephemeralExpire, function(error, result) {
            log.debug("" + _this.id + ": expire", p, result, _this.ephemeralRefresh);
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
    if (p.length - 1 === p.indexOf("*")) {
      p = p.replace("*", "");
    }
    log.debug("" + this.id + ": list", "" + p + "*");
    return this.client.keys("" + p + "*", (function(_this) {
      return function(error, keys) {
        var key, ks, _i, _len;
        log.debug("" + _this.id + ": list keys", "" + p + "*", keys);
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
    log.debug("" + this.id + ": register", role);
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
          return cb(error, port);
        });
      };
    })(this));
  };

  RedisPort.prototype.free = function(role, cb) {
    var p;
    p = this._cleanPath("services/" + role);
    return this.get(p, (function(_this) {
      return function(error, service) {
        if (error) {
          return cb(error);
        }
        return _this.del(role, function(error) {
          if (error) {
            return cb(error);
          }
          return cb();
        });
      };
    })(this));
  };

  RedisPort.prototype.query = function(role, fn) {
    var p, subscriptionKey;
    log.debug("" + this.id + ": query", role);
    p = this._cleanPath("services/" + role);
    subscriptionKey = "__keyspace@0__:" + p;
    this.subscriber.psubscribe(subscriptionKey);
    if (role.length - 1 === role.indexOf("*")) {
      this.wildcards[subscriptionKey] = {
        path: p,
        fn: fn,
        role: role
      };
      return this.getServices(role, function(error, services) {
        var service, _i, _len, _results;
        _results = [];
        for (_i = 0, _len = services.length; _i < _len; _i++) {
          service = services[_i];
          _results.push(fn(service));
        }
        return _results;
      });
    } else {
      this.subscriptions[subscriptionKey] = {
        path: p,
        fn: fn,
        role: role
      };
      return this.get(p, (function(_this) {
        return function(error, service) {
          if (service) {
            return fn(service);
          }
        };
      })(this));
    }
  };

  RedisPort.prototype.getServices = function(wildcard, cb) {
    var queryPath;
    if (!cb) {
      cb = wildcard;
      wildcard = null;
    }
    queryPath = this.servicesPath;
    if (wildcard) {
      queryPath += "/" + wildcard;
    }
    log.debug("" + this.id + ": get services", wildcard, queryPath);
    return this.list(queryPath, (function(_this) {
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
          return cb(error, services);
        });
      };
    })(this));
  };

  RedisPort.prototype.getPorts = function(cb) {
    log.debug("" + this.id + ": get ports");
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
