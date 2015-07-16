var EventEmitter, RedisPort, _, assert, async, log, path, redis,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

_ = require("underscore");

assert = require("assert");

async = require("async");

path = require("path");

redis = require("redis");

EventEmitter = require("events").EventEmitter;

log = require("./log");

RedisPort = (function(superClass) {
  extend(RedisPort, superClass);

  RedisPort.prototype.client = null;

  RedisPort.prototype.ephemerals = null;

  RedisPort.prototype.ephemeralExpire = 15000;

  RedisPort.prototype.ephemeralRefresh = 10000;

  RedisPort.prototype.prefix = "redis-port";

  RedisPort.prototype.rootPath = null;

  RedisPort.prototype.servicesPath = "services";

  RedisPort.prototype.subscriber = null;

  RedisPort.prototype.subscriptions = null;

  RedisPort.prototype.queuePath = "queue";

  RedisPort.prototype.queueRootPath = null;

  RedisPort.prototype.queueMaxLength = null;

  function RedisPort(options, id) {
    var attr, i, len1, ref;
    this.id = id;
    this.redisHost = options.redisHost, this.redisPort = options.redisPort, this.host = options.host, this.env = options.env, this.project = options.project;
    ref = ["redisHost", "redisPort", "env", "host", "project"];
    for (i = 0, len1 = ref.length; i < len1; i++) {
      attr = ref[i];
      assert(this[attr], "`" + attr + "` is required");
    }
    this.id || (this.id = Math.round(Math.random() * 10000));
    this.ephemeralExpire = options.ephemeralExpire || this.ephemeralExpire;
    this.ephemeralRefresh = options.ephemeralRefresh || this.ephemeralRefresh;
    this.prefix = options.prefix || this.prefix;
    this.rootPath = "/" + this.prefix + "/" + this.project + "/" + this.env;
    this.queueRootPath = this._cleanPath("queues");
  }

  RedisPort.prototype.start = function(cb) {
    log.debug(this.id + ": connecting to " + this.redisHost + ":" + this.redisPort);
    this.ephemerals = {};
    this.subscriptions = {};
    this.subscriber = redis.createClient(this.redisPort, this.redisHost, {
      retry_max_delay: 10000
    });
    this.subscriber.on("pmessage", (function(_this) {
      return function(pattern, channel, key) {
        var serviceRole, sub;
        log.debug(_this.id + ": pmessage", pattern, key);
        switch (key) {
          case "set":
            sub = _this.subscriptions[pattern];
            if (!sub) {
              return log.debug(_this.id + ": no subscription for " + pattern);
            }
            if (pattern.length - 1 === pattern.indexOf("*")) {
              serviceRole = channel.replace("__keyspace@0__:", "");
              return _this.get(serviceRole, function(error, service) {
                if (error) {
                  return log.error("get error " + error.message);
                }
                return typeof sub.regFn === "function" ? sub.regFn(service) : void 0;
              });
            } else {
              return _this.get(sub.path, function(error, service) {
                if (error) {
                  return log.error("get error " + error.message);
                }
                return typeof sub.regFn === "function" ? sub.regFn(service) : void 0;
              });
            }
            break;
          case "del":
            sub = _this.subscriptions[pattern];
            if (!sub) {
              return log.debug(_this.id + ": no subscription for " + pattern);
            }
            if (pattern.length - 1 === pattern.indexOf("*")) {
              serviceRole = channel.replace("__keyspace@0__:", "");
              return typeof sub.freeFn === "function" ? sub.freeFn(serviceRole.replace(_this.rootPath + "/services/", "")) : void 0;
            } else {
              return typeof sub.freeFn === "function" ? sub.freeFn(sub.role) : void 0;
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
        log.debug(_this.id + ": Connected.");
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

  RedisPort.prototype.stop = function(cb) {
    log.debug(this.id + ": stopping");
    return async.each(Object.keys(this.ephemerals), ((function(_this) {
      return function(key, cb) {
        clearTimeout(_this.ephemerals[key]);
        return _this.del(key, cb);
      };
    })(this)), (function(_this) {
      return function() {
        _this.client.end();
        _this.subscriber.end();
        _this.emit("stopped");
        log.debug(_this.id + ": stopped");
        return typeof cb === "function" ? cb() : void 0;
      };
    })(this));
  };

  RedisPort.prototype.clearQueue = function(queue, cb) {
    return this.client.del(this.queueRootPath + "/" + queue, cb);
  };

  RedisPort.prototype.queueLength = function(queue, cb) {
    return this.client.llen(this.queueRootPath + "/" + queue, cb);
  };

  RedisPort.prototype.enqueue = function(queue, msg, cb) {
    return this.client.rpush(this.queueRootPath + "/" + queue, msg, (function(_this) {
      return function(error, len) {
        if (!_this.queueMaxLength) {
          return cb(error, len);
        }
        if (!(len > _this.queueMaxLength)) {
          return cb(error, len);
        }
        return _this.client.ltrim([_this.queueRootPath + "/" + queue, 1 + len - _this.queueMaxLength, -1], function(error) {
          return cb(error, len);
        });
      };
    })(this));
  };

  RedisPort.prototype.dequeue = function(queue, cb) {
    return this.client.blpop(this.queueRootPath + "/" + queue, 0, function(error, msg) {
      return cb(error, msg[1]);
    });
  };

  RedisPort.prototype.pset = function(p, data, cb) {
    p = this._cleanPath(p);
    return this.client.set(p, JSON.stringify(data), function(error, result) {
      log.debug(this.id + ": set", p, result);
      return typeof cb === "function" ? cb(error) : void 0;
    });
  };

  RedisPort.prototype.mpset = function(arr, cb) {
    if (!Array.isArray(arr)) {
      return typeof cb === "function" ? cb(new Error("No 2D array")) : void 0;
    }
    if (arr.length && !Array.isArray(arr[0])) {
      return typeof cb === "function" ? cb(new Error("No 2D array")) : void 0;
    }
    return async.each(arr, ((function(_this) {
      return function(a, cb) {
        return _this.pset(a[0], a[1], cb);
      };
    })(this)), function(error) {
      return typeof cb === "function" ? cb(error) : void 0;
    });
  };

  RedisPort.prototype.get = function(p, cb) {
    p = this._cleanPath(p);
    return this.client.get(p, (function(_this) {
      return function(error, data) {
        log.debug(_this.id + ": get", p);
        return cb(error, JSON.parse(data));
      };
    })(this));
  };

  RedisPort.prototype.del = function(p, cb) {
    p = this._cleanPath(p);
    return this.client.keys(p + "*", (function(_this) {
      return function(error, keys) {
        log.debug(_this.id + ": keys", p + "*", keys);
        if (error) {
          return typeof cb === "function" ? cb(error) : void 0;
        }
        return async.eachSeries(keys, (function(k, cb) {
          clearTimeout(_this.ephemerals[k]);
          return _this.client.del(k, function(error, result) {
            log.debug(_this.id + ": del", k, result);
            return cb(error);
          });
        }), function(error) {
          return typeof cb === "function" ? cb(error) : void 0;
        });
      };
    })(this));
  };

  RedisPort.prototype.mdel = function(keys, cb) {
    if (!Array.isArray(keys)) {
      return typeof cb === "function" ? cb(new Error("No array")) : void 0;
    }
    return async.each(keys, ((function(_this) {
      return function(key, cb) {
        return _this.del(key, cb);
      };
    })(this)), function(error) {
      return typeof cb === "function" ? cb(error) : void 0;
    });
  };

  RedisPort.prototype.set = function(p, data, cb) {
    p = this._cleanPath(p);
    return this.client.psetex(p, this.ephemeralExpire, JSON.stringify(data), (function(_this) {
      return function(error, result) {
        var updateExpire;
        log.debug(_this.id + ": setex", p, _this.ephemeralExpire);
        if (error) {
          return typeof cb === "function" ? cb(error) : void 0;
        }
        updateExpire = function() {
          return _this.client.pexpire(p, _this.ephemeralExpire, function(error, result) {
            log.debug(_this.id + ": expire", p, result, _this.ephemeralRefresh);
            if (error) {
              return log.error("Error setting expire on " + p + ": " + error.message);
            }
            return _this.ephemerals[p] = setTimeout(updateExpire, _this.ephemeralRefresh);
          });
        };
        updateExpire();
        return typeof cb === "function" ? cb() : void 0;
      };
    })(this));
  };

  RedisPort.prototype.mset = function(arr, cb) {
    if (!Array.isArray(arr)) {
      return typeof cb === "function" ? cb(new Error("No 2D array")) : void 0;
    }
    if (arr.length && !Array.isArray(arr[0])) {
      return typeof cb === "function" ? cb(new Error("No 2D array")) : void 0;
    }
    return async.each(arr, ((function(_this) {
      return function(a, cb) {
        return _this.set(a[0], a[1], cb);
      };
    })(this)), function(error) {
      return typeof cb === "function" ? cb(error) : void 0;
    });
  };

  RedisPort.prototype.list = function(p, cb) {
    p = this._cleanPath(p);
    if (p.length - 1 === p.indexOf("*")) {
      p = p.replace("*", "");
    }
    log.debug(this.id + ": list", p + "*");
    return this.client.keys(p + "*", (function(_this) {
      return function(error, keys) {
        var i, key, ks, len1;
        log.debug(_this.id + ": list keys", p + "*", keys);
        if (error) {
          return cb(error);
        }
        ks = [];
        for (i = 0, len1 = keys.length; i < len1; i++) {
          key = keys[i];
          ks.push(key.replace(_this.rootPath + "/", ""));
        }
        return cb(null, ks);
      };
    })(this));
  };

  RedisPort.prototype.register = function(role, cb) {
    var port;
    log.debug(this.id + ": register", role);
    if (typeof role === 'object') {
      port = role.port;
      role = role.role;
    }
    return this.getPorts((function(_this) {
      return function(error, ports) {
        if (error) {
          return cb(error);
        }
        while ((port == null) || indexOf.call(ports, port) >= 0) {
          port = 10000 + Math.floor(Math.random() * 55000);
        }
        return _this.pset("services/" + role, {
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
    log.debug(this.id + ": free", role);
    p = this._cleanPath("services/" + role);
    return this.get(p, (function(_this) {
      return function(error, service) {
        if (error) {
          return typeof cb === "function" ? cb(error) : void 0;
        }
        return _this.del(p, function(error) {
          return typeof cb === "function" ? cb(error, service) : void 0;
        });
      };
    })(this));
  };

  RedisPort.prototype.query = function(role, regFn, freeFn) {
    var env, p, project, subscriptionKey;
    log.debug(this.id + ": query", role);
    project = void 0;
    env = void 0;
    if (_.isObject(role)) {
      project = role.project;
      env = role.env;
      role = role.role;
    }
    p = this._cleanPath("services/" + role, project, env);
    subscriptionKey = "__keyspace@0__:" + p;
    this.subscriber.psubscribe(subscriptionKey);
    this.subscriptions[subscriptionKey] = {
      path: p,
      role: role,
      regFn: regFn,
      freeFn: freeFn
    };
    if (role.length - 1 === role.indexOf("*")) {
      return this.getServices(role, function(error, services) {
        var i, len1, results, service;
        if (error) {
          return log.error(this.id + ": Error get services: " + error.message);
        }
        results = [];
        for (i = 0, len1 = services.length; i < len1; i++) {
          service = services[i];
          results.push(regFn(service));
        }
        return results;
      });
    } else {
      return this.get(p, (function(_this) {
        return function(error, service) {
          if (error) {
            return log.error(_this.id + ": Error get: " + error.message);
          }
          if (service) {
            return regFn(service);
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
    log.debug(this.id + ": get services", wildcard, queryPath);
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
    log.debug(this.id + ": get ports");
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

  RedisPort.prototype._cleanPath = function(p, project, env) {
    var rootPath;
    project || (project = this.project);
    env || (env = this.env);
    rootPath = "/" + this.prefix + "/" + project + "/" + env;
    if (0 === p.indexOf(rootPath)) {
      return p;
    }
    return path.resolve(rootPath, p);
  };

  return RedisPort;

})(EventEmitter);

module.exports = RedisPort;
