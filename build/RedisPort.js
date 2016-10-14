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

  RedisPort.prototype.missedPath = "missed";

  RedisPort.prototype.missedLength = 10000;

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
    this.subscriber = redis.createClient(this.redisPort, this.redisHost);
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
    this.client = redis.createClient(this.redisPort, this.redisHost);
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
    return async.each(Object.keys(this.ephemerals || []), ((function(_this) {
      return function(key, cb) {
        clearTimeout(_this.ephemerals[key]);
        return _this.del(key, cb);
      };
    })(this)), (function(_this) {
      return function() {
        var ref, ref1;
        if ((ref = _this.client) != null) {
          ref.end(true);
        }
        if ((ref1 = _this.subscriber) != null) {
          ref1.end(true);
        }
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
    return this.client.lpush(this.queueRootPath + "/" + queue, msg, (function(_this) {
      return function(error, len) {
        if (!_this.queueMaxLength) {
          return cb(error, len);
        }
        if (!(len > _this.queueMaxLength)) {
          return cb(error, len);
        }
        return _this.client.ltrim([_this.queueRootPath + "/" + queue, 0, _this.queueMaxLength - 2], function(error) {
          return cb(error, len);
        });
      };
    })(this));
  };

  RedisPort.prototype.dequeue = function(queue, cb) {
    return this.client.brpop(this.queueRootPath + "/" + queue, 0, function(error, msg) {
      return cb(error, msg[1]);
    });
  };

  RedisPort.prototype.pset = function(p, data, cb) {
    p = this._cleanPath(p);
    return this.client.set(p, JSON.stringify(data), (function(_this) {
      return function(error, result) {
        log.debug(_this.id + ": set", p, result);
        return typeof cb === "function" ? cb(error) : void 0;
      };
    })(this));
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

  RedisPort.prototype.logMissed = function(p) {
    var info, missedPathFull;
    log.debug(this.id + ": logMissed", p);
    info = {
      path: p,
      redisHost: this.redisHost,
      redisPort: this.redisPort,
      host: this.host,
      env: this.env,
      project: this.project,
      time: new Date
    };
    missedPathFull = this._cleanPath(this.missedPath);
    return this.client.lpush([missedPathFull, JSON.stringify(info)], (function(_this) {
      return function(error) {
        if (error) {
          return log.error("Error in lpush: " + error.message);
        }
        _this.emit("missed", p, info);
        return _this.client.ltrim([missedPathFull, 0, _this.missedLength - 1], function(error) {
          if (error) {
            return log.error("Error in ltrim: " + error.message);
          }
        });
      };
    })(this));
  };

  RedisPort.prototype.get = function(p, cb) {
    p = this._cleanPath(p);
    return this.client.get(p, (function(_this) {
      return function(error, data) {
        log.debug(_this.id + ": get", p);
        if (!data) {
          _this.logMissed(p);
        }
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

  RedisPort.prototype.register = function(role, forcePort, cb) {
    var host, port;
    log.debug(this.id + ": register", role);
    if (!cb) {
      cb = forcePort;
      forcePort = false;
    }
    host = this.host;
    if (typeof role === 'object') {
      host = role.host || host;
      port = role.port;
      role = role.role;
    }
    return this.getPorts((function(_this) {
      return function(error, ports) {
        if (error) {
          return cb(error);
        }
        if (!forcePort) {
          while ((port == null) || indexOf.call(ports, port) >= 0) {
            port = 10000 + Math.floor(Math.random() * 55000);
          }
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
      return this.getServices(role, (function(_this) {
        return function(error, services) {
          var i, len1, results, service;
          if (error) {
            return log.error(_this.id + ": Error get services: " + error.message);
          }
          results = [];
          for (i = 0, len1 = services.length; i < len1; i++) {
            service = services[i];
            results.push(regFn(service));
          }
          return results;
        };
      })(this));
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

  RedisPort.prototype.unquery = function(role) {
    var env, p, project, subscriptionKey;
    log.debug(this.id + ": unquery", role);
    project = void 0;
    env = void 0;
    if (_.isObject(role)) {
      project = role.project;
      env = role.env;
      role = role.role;
    }
    p = this._cleanPath("services/" + role, project, env);
    subscriptionKey = "__keyspace@0__:" + p;
    this.subscriber.punsubscribe(subscriptionKey);
    return delete this.subscriptions[subscriptionKey];
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

//# sourceMappingURL=data:application/json;charset=utf8;base64,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c0JBbUJWLFVBQUEsR0FBWSxTQUFDLENBQUQsRUFBSSxPQUFKLEVBQWEsR0FBYjtBQUNYLFFBQUE7SUFBQSxZQUFBLFVBQVksSUFBQyxDQUFBO0lBQ2IsUUFBQSxNQUFZLElBQUMsQ0FBQTtJQUViLFFBQUEsR0FBVyxHQUFBLEdBQUksSUFBQyxDQUFBLE1BQUwsR0FBWSxHQUFaLEdBQWUsT0FBZixHQUF1QixHQUF2QixHQUEwQjtJQUVyQyxJQUFZLENBQUEsS0FBSyxDQUFDLENBQUMsT0FBRixDQUFVLFFBQVYsQ0FBakI7QUFBQSxhQUFPLEVBQVA7O1dBQ0EsSUFBSSxDQUFDLE9BQUwsQ0FBYSxRQUFiLEVBQXVCLENBQXZCO0VBUFc7Ozs7R0E1ZVc7O0FBcWZ4QixNQUFNLENBQUMsT0FBUCxHQUFpQiIsImZpbGUiOiJSZWRpc1BvcnQuanMiLCJzb3VyY2VzQ29udGVudCI6WyJfICAgICAgICAgICAgICAgID0gcmVxdWlyZSBcInVuZGVyc2NvcmVcIlxuYXNzZXJ0ICAgICAgICAgICA9IHJlcXVpcmUgXCJhc3NlcnRcIlxuYXN5bmMgICAgICAgICAgICA9IHJlcXVpcmUgXCJhc3luY1wiXG5wYXRoICAgICAgICAgICAgID0gcmVxdWlyZSBcInBhdGhcIlxucmVkaXMgICAgICAgICAgICA9IHJlcXVpcmUgXCJyZWRpc1wiXG57IEV2ZW50RW1pdHRlciB9ID0gcmVxdWlyZSBcImV2ZW50c1wiXG5cbmxvZyA9IHJlcXVpcmUgXCIuL2xvZ1wiXG5cbiMgU2VydmljZSByZWdpc3RyeSBhbmQgcG9ydCBhc3NpZ25tZW50IHVzaW5nIFJlZGlzXG4jXG4jIENyZWF0ZXMgdHdvIHJlZGlzIGNsaWVudHMgdG8gc3VwcG9ydFxuIyAtIEtleSBzcGFjZSBub3RpZmljYXRpb24gc3Vic2NyaXB0aW9uc1xuIyAtIEVwaGVtZXJhbCBuZXR3b3JrIHN0b3JhZ2VcbiNcbmNsYXNzIFJlZGlzUG9ydCBleHRlbmRzIEV2ZW50RW1pdHRlclxuXHQjIEBwcm9wZXJ0eSBbT2JqZWN0XSBSZWRpcyBjbGllbnQgdG8gc2V0L2dldCB3aXRoXG5cdGNsaWVudDogICAgICAgICAgIG51bGxcblxuXHQjIEBwcm9wZXJ0eSBbT2JqZWN0XSBJbnRlcnZhbCBjb2xsZWN0aW9uIHRoZSByZXNldHMgdGhlIGV4cGlyZSBmbGFnc1xuXHRlcGhlbWVyYWxzOiAgICAgICBudWxsXG5cblx0IyBAcHJvcGVydHkgW051bWJlcl0gTWlsbGlzZWNvbmRzIHRvIGV4cGlyZVxuXHRlcGhlbWVyYWxFeHBpcmU6ICAxNTAwMFxuXG5cdCMgQHByb3BlcnR5IFtOdW1iZXJdIE1pbGxpc2Vjb25kcyB0byByZXNldCBleHBpcmVcblx0ZXBoZW1lcmFsUmVmcmVzaDogMTAwMDBcblxuXHQjIEBwcm9wZXJ0eSBbU3RyaW5nXSBNYWluIHByZWZpeFxuXHRwcmVmaXg6ICAgICAgICAgICBcInJlZGlzLXBvcnRcIlxuXG5cdCMgQHByb3BlcnR5IFtTdHJpbmddIFRoZSBleHRlbmRlZCBwcmVmaXggb2YgZWFjaCBrZXlcblx0cm9vdFBhdGg6ICAgICAgICAgbnVsbFxuXG5cdCMgQHByb3BlcnR5IFtTdHJpbmddIERlZmF1bHQgcGF0aCB0byBzdWJzY3JpYmUgbmV0d29yayBzZXJ2aWNlcyB3aXRoXG5cdHNlcnZpY2VzUGF0aDogICAgIFwic2VydmljZXNcIlxuXG5cdCMgQHByb3BlcnR5IFtTdHJpbmddIERlZmF1bHQgcGF0aCB0byBtaXNzZWQga2V5c1xuXHRtaXNzZWRQYXRoOiAgICAgICBcIm1pc3NlZFwiXG5cblx0IyBAcHJvcGVydHkgW1N0cmluZ10gRGVmYXVsdCBsZW50aCBvZiBtaXNzZWQga2V5cyBsaXN0XG5cdG1pc3NlZExlbmd0aDogICAgIDEwMDAwXG5cblx0IyBAcHJvcGVydHkgW09iamVjdF0gUmVkaXMgY2xpZW50IHRvIHN1YnNjcmliZSB3aXRoXG5cdHN1YnNjcmliZXI6ICAgICAgIG51bGxcblxuXHQjIEBwcm9wZXJ0eSBbT2JqZWN0XSBTdWJzY3JpcHRpb24gcmVnaXN0cnlcblx0c3Vic2NyaXB0aW9uczogICAgbnVsbFxuXG5cdCMgQHByb3BlcnR5IFtTdGluZ10gUXVldWUgcHJlZml4XG5cdHF1ZXVlUGF0aDogICAgICAgIFwicXVldWVcIlxuXG5cdCMgQHByb3BlcnR5IFtTdGluZ10gUXVldWUgcHJlZml4XG5cdHF1ZXVlUm9vdFBhdGg6ICAgIG51bGxcblxuXHQjIEBwcm9wZXJ0eSBbU3RpbmddIE1heCBxdWV1ZSBsZW5ndGhcblx0cXVldWVNYXhMZW5ndGg6ICAgbnVsbFxuXG5cdCMgQ29uc3RydWN0b3Jcblx0I1xuXHQjIEBwYXJhbSBvcHRpb25zIFtPYmplY3RdIE1haW4gb3B0aW9uc1xuXHQjIEBvcHRpb24gcmVkaXNIb3N0IFtTdHJpbmddIEhvc3RuYW1lIG9mIFJlZGlzIHNlcnZpY2Vcblx0IyBAb3B0aW9uIHJlZGlzUG9ydCBbTnVtYmVyXSBQb3J0IG9mIFJlZGlzIHNlcnZpY2Vcblx0IyBAb3B0aW9uIGhvc3QgW1N0cmluZ10gSG9zdG5hbWUgb2YgdGhlIGN1cnJlbnQgbWFjaGluZVxuXHQjIEBvcHRpb24gZW52IFtTdHJpbmddIEVudmlyb25tZW50XG5cdCMgQG9wdGlvbiBwcm9qZWN0IFtTdHJpbmddIFByb2plY3QgbmFtZVxuXHQjIEBvcHRpb24gcHJlZml4IFtTdHJpbmddIE1haW4gcHJlZml4XG5cdCNcblx0Y29uc3RydWN0b3I6IChvcHRpb25zLCBAaWQpIC0+XG5cdFx0eyBAcmVkaXNIb3N0LCBAcmVkaXNQb3J0LCBAaG9zdCwgQGVudiwgQHByb2plY3QgfSA9IG9wdGlvbnNcblxuXHRcdGFzc2VydCBAW2F0dHJdLCBcImAje2F0dHJ9YCBpcyByZXF1aXJlZFwiIGZvciBhdHRyIGluIFtcblx0XHRcdFwicmVkaXNIb3N0XCIgIyByZWRpcyBzZXJ2ZXIgaG9zdG5hbWVcblx0XHRcdFwicmVkaXNQb3J0XCIgIyByZWRpcyBzZXJ2ZXIgcG9ydFxuXHRcdFx0XCJlbnZcIiAgICAgICAjIGVudmlyb25tZW50XG5cdFx0XHRcImhvc3RcIiAgICAgICMgY2xpZW50IGhvc3RuYW1lXG5cdFx0XHRcInByb2plY3RcIiAgICMgcHJvamVjdCBuYW1lXG5cdFx0XVxuXG5cdFx0QGlkIG9yPSBNYXRoLnJvdW5kIE1hdGgucmFuZG9tKCkgKiAxMDAwMFxuXG5cdFx0QGVwaGVtZXJhbEV4cGlyZSAgPSBvcHRpb25zLmVwaGVtZXJhbEV4cGlyZSAgb3IgQGVwaGVtZXJhbEV4cGlyZVxuXHRcdEBlcGhlbWVyYWxSZWZyZXNoID0gb3B0aW9ucy5lcGhlbWVyYWxSZWZyZXNoIG9yIEBlcGhlbWVyYWxSZWZyZXNoXG5cdFx0QHByZWZpeCAgICAgICAgICAgPSBvcHRpb25zLnByZWZpeCAgICAgICAgICAgb3IgQHByZWZpeFxuXG5cdFx0QHJvb3RQYXRoICAgICAgPSBcIi8je0BwcmVmaXh9LyN7QHByb2plY3R9LyN7QGVudn1cIlxuXHRcdEBxdWV1ZVJvb3RQYXRoID0gQF9jbGVhblBhdGggXCJxdWV1ZXNcIlxuXG5cdCMgU3RhcnQgZnVuY3Rpb24gd2l0aCBjYWxsYmFja1xuXHQjXG5cdCMgQHBhcmFtIFtGdW5jdGlvbl0gQ2FsbGJhY2sgZnVuY3Rpb25cblx0I1xuXHRzdGFydDogKGNiKSAtPlxuXHRcdGxvZy5kZWJ1ZyBcIiN7QGlkfTogY29ubmVjdGluZyB0byAje0ByZWRpc0hvc3R9OiN7QHJlZGlzUG9ydH1cIlxuXG5cdFx0QGVwaGVtZXJhbHMgICAgPSB7fVxuXHRcdEBzdWJzY3JpcHRpb25zID0ge31cblxuXHRcdEBzdWJzY3JpYmVyID0gcmVkaXMuY3JlYXRlQ2xpZW50IEByZWRpc1BvcnQsIEByZWRpc0hvc3RcblxuXHRcdEBzdWJzY3JpYmVyLm9uIFwicG1lc3NhZ2VcIiwgKHBhdHRlcm4sIGNoYW5uZWwsIGtleSkgPT5cblx0XHRcdGxvZy5kZWJ1ZyBcIiN7QGlkfTogcG1lc3NhZ2VcIiwgcGF0dGVybiwga2V5XG5cblx0XHRcdHN3aXRjaCBrZXlcblx0XHRcdFx0d2hlbiBcInNldFwiXG5cdFx0XHRcdFx0c3ViID0gQHN1YnNjcmlwdGlvbnNbcGF0dGVybl1cblx0XHRcdFx0XHRyZXR1cm4gbG9nLmRlYnVnIFwiI3tAaWR9OiBubyBzdWJzY3JpcHRpb24gZm9yICN7cGF0dGVybn1cIiB1bmxlc3Mgc3ViXG5cblx0XHRcdFx0XHRpZiBwYXR0ZXJuLmxlbmd0aCAtIDEgaXMgcGF0dGVybi5pbmRleE9mIFwiKlwiXG5cdFx0XHRcdFx0XHRzZXJ2aWNlUm9sZSA9IGNoYW5uZWwucmVwbGFjZSBcIl9fa2V5c3BhY2VAMF9fOlwiLCBcIlwiXG5cblx0XHRcdFx0XHRcdEBnZXQgc2VydmljZVJvbGUsIChlcnJvciwgc2VydmljZSkgLT5cblx0XHRcdFx0XHRcdFx0cmV0dXJuIGxvZy5lcnJvciBcImdldCBlcnJvciAje2Vycm9yLm1lc3NhZ2V9XCIgaWYgZXJyb3JcblxuXHRcdFx0XHRcdFx0XHRzdWIucmVnRm4/IHNlcnZpY2VcblxuXHRcdFx0XHRcdGVsc2Vcblx0XHRcdFx0XHRcdEBnZXQgc3ViLnBhdGgsIChlcnJvciwgc2VydmljZSkgPT5cblx0XHRcdFx0XHRcdFx0cmV0dXJuIGxvZy5lcnJvciBcImdldCBlcnJvciAje2Vycm9yLm1lc3NhZ2V9XCIgaWYgZXJyb3JcblxuXHRcdFx0XHRcdFx0XHRzdWIucmVnRm4/IHNlcnZpY2VcblxuXHRcdFx0XHR3aGVuIFwiZGVsXCJcblx0XHRcdFx0XHRzdWIgPSBAc3Vic2NyaXB0aW9uc1twYXR0ZXJuXVxuXHRcdFx0XHRcdHJldHVybiBsb2cuZGVidWcgXCIje0BpZH06IG5vIHN1YnNjcmlwdGlvbiBmb3IgI3twYXR0ZXJufVwiIHVubGVzcyBzdWJcblxuXHRcdFx0XHRcdGlmIHBhdHRlcm4ubGVuZ3RoIC0gMSBpcyBwYXR0ZXJuLmluZGV4T2YgXCIqXCJcblx0XHRcdFx0XHRcdHNlcnZpY2VSb2xlID0gY2hhbm5lbC5yZXBsYWNlIFwiX19rZXlzcGFjZUAwX186XCIsIFwiXCJcblx0XHRcdFx0XHRcdHN1Yi5mcmVlRm4/IHNlcnZpY2VSb2xlLnJlcGxhY2UgXCIje0Byb290UGF0aH0vc2VydmljZXMvXCIsIFwiXCJcblx0XHRcdFx0XHRlbHNlXG5cdFx0XHRcdFx0XHRzdWIuZnJlZUZuPyBzdWIucm9sZVxuXG5cdFx0QHN1YnNjcmliZXIub24gXCJlcnJvclwiLCAoZXJyb3IpID0+XG5cdFx0XHRsb2cud2FybiBcIlJlZGlzIGNsaWVudCBlcnJvcjogI3tlcnJvci5tZXNzYWdlfVwiXG5cdFx0XHRAZW1pdCBcInJlY29ubmVjdFwiXG5cblx0XHRAY2xpZW50ID0gcmVkaXMuY3JlYXRlQ2xpZW50IEByZWRpc1BvcnQsIEByZWRpc0hvc3RcblxuXHRcdEBjbGllbnQub25jZSBcImNvbm5lY3RcIiwgKGVycm9yKSA9PlxuXHRcdFx0bG9nLmRlYnVnIFwiI3tAaWR9OiBDb25uZWN0ZWQuXCJcblx0XHRcdEBlbWl0IFwic3RhcnRlZFwiXG5cdFx0XHRjYj8oKVxuXG5cdFx0QGNsaWVudC5vbiBcImVycm9yXCIsIChlcnJvcikgPT5cblx0XHRcdGxvZy53YXJuIFwiUmVkaXMgY2xpZW50IGVycm9yOiAje2Vycm9yLm1lc3NhZ2V9XCJcblx0XHRcdEBlbWl0IFwicmVjb25uZWN0XCJcblxuXHQjIFN0b3AgdGhlIGNsaWVudFxuXHQjXG5cdHN0b3A6IChjYikgLT5cblx0XHRsb2cuZGVidWcgXCIje0BpZH06IHN0b3BwaW5nXCJcblxuXHRcdGFzeW5jLmVhY2ggKE9iamVjdC5rZXlzIEBlcGhlbWVyYWxzIG9yIFtdKSwgKChrZXksIGNiKSA9PlxuXHRcdFx0Y2xlYXJUaW1lb3V0IEBlcGhlbWVyYWxzW2tleV1cblx0XHRcdEBkZWwga2V5LCBjYlxuXHRcdCksID0+XG5cdFx0XHRAY2xpZW50Py5lbmQgdHJ1ZVxuXHRcdFx0QHN1YnNjcmliZXI/LmVuZCB0cnVlXG5cblx0XHRcdEBlbWl0IFwic3RvcHBlZFwiXG5cdFx0XHRsb2cuZGVidWcgXCIje0BpZH06IHN0b3BwZWRcIlxuXG5cdFx0XHRjYj8oKVxuXG5cdCMgU2V0cyB0aGUgY3VycmVudCBxdWV1ZSBuYW1lXG5cdCNcblx0IyBAcGFyYW0gW0Z1bmN0aW9uXSBDYWxsYmFjayBmdW5jdGlvblxuXHQjXG5cdGNsZWFyUXVldWU6IChxdWV1ZSwgY2IpIC0+XG5cdFx0QGNsaWVudC5kZWwgXCIje0BxdWV1ZVJvb3RQYXRofS8je3F1ZXVlfVwiLCBjYlxuXG5cdCMgR2V0cyB0aGUgY3VycmVudCBxdWV1ZSBsZW5ndGhcblx0I1xuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIENhbGxiYWNrIGZ1bmN0aW9uXG5cdCNcblx0cXVldWVMZW5ndGg6IChxdWV1ZSwgY2IpIC0+XG5cdFx0QGNsaWVudC5sbGVuIFwiI3tAcXVldWVSb290UGF0aH0vI3txdWV1ZX1cIiwgY2JcblxuXHQjIEFkZCB0byB0aGUgcXVldWVcblx0I1xuXHQjIEBwYXJhbSBbU3RyaW5nXSBRdWV1ZSBuYW1lXG5cdCMgQHBhcmFtIFtGdW5jdGlvbl0gQ2FsbGJhY2sgZnVuY3Rpb25cblx0I1xuXHRlbnF1ZXVlOiAocXVldWUsIG1zZywgY2IpIC0+XG5cdFx0QGNsaWVudC5scHVzaCBcIiN7QHF1ZXVlUm9vdFBhdGh9LyN7cXVldWV9XCIsIG1zZywgKGVycm9yLCBsZW4pID0+XG5cdFx0XHRyZXR1cm4gY2IgZXJyb3IsIGxlbiB1bmxlc3MgQHF1ZXVlTWF4TGVuZ3RoXG5cdFx0XHRyZXR1cm4gY2IgZXJyb3IsIGxlbiB1bmxlc3MgbGVuID4gQHF1ZXVlTWF4TGVuZ3RoXG5cblx0XHRcdEBjbGllbnQubHRyaW0gW1wiI3tAcXVldWVSb290UGF0aH0vI3txdWV1ZX1cIiwgMCwgQHF1ZXVlTWF4TGVuZ3RoIC0gMl0sIChlcnJvcikgLT5cblx0XHRcdFx0Y2IgZXJyb3IsIGxlblxuXG5cdCMgR2V0IGZyb20gdGhlIHF1ZXVlXG5cdCMgVGhpcyBpcyBibG9ja2luZyBscG9wLCBndWFyZW50ZWVkIHRvIHJldHVybiBhIG1zZ1xuXHQjIFVzZSBvbmx5IG9uZSBpbnN0YW5jZSBvZiBSZWRpc1BvcnQgZm9yIHRoaXNcblx0I1xuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIENhbGxiYWNrIGZ1bmN0aW9uXG5cdCNcblx0ZGVxdWV1ZTogKHF1ZXVlLCBjYikgLT5cblx0XHRAY2xpZW50LmJycG9wIFwiI3tAcXVldWVSb290UGF0aH0vI3txdWV1ZX1cIiwgMCwgKGVycm9yLCBtc2cpIC0+XG5cdFx0XHRjYiBlcnJvciwgbXNnWzFdXG5cblx0IyBQZXJzaXN0YW50bHkgc2V0IGEga2V5LXZhbHVlXG5cdCNcblx0IyBAcGFyYW0gW1N0cmluZ10gUmVsYXRpdmUgcGF0aFxuXHQjIEBwYXJhbSBbYW55XSBEYXRhIHRvIHN0b3JlXG5cdCMgQHBhcmFtIFtGdW5jdGlvbl0gQ2FsbGJhY2sgZnVuY3Rpb25cblx0I1xuXHRwc2V0OiAocCwgZGF0YSwgY2IpIC0+XG5cdFx0cCA9IEBfY2xlYW5QYXRoIHBcblx0XHRAY2xpZW50LnNldCBwLCBKU09OLnN0cmluZ2lmeShkYXRhKSwgKGVycm9yLCByZXN1bHQpID0+XG5cdFx0XHRsb2cuZGVidWcgXCIje0BpZH06IHNldFwiLCBwLCByZXN1bHRcblx0XHRcdGNiPyBlcnJvclxuXG5cdCMgU2V0IGFycmF5IG9mIHBlcnNpc3RhbnQga2V5LXZhbHVlc1xuXHQjXG5cdCMgQHBhcmFtIFtBcnJheV0gTXV0bGlwbGUga2V5LXZhbHVlIGNvbWJpbmF0aW9uc1xuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIENhbGxiYWNrIGZ1bmN0aW9uXG5cdCNcblx0bXBzZXQ6IChhcnIsIGNiKSAtPlxuXHRcdHJldHVybiBjYj8gbmV3IEVycm9yIFwiTm8gMkQgYXJyYXlcIiB1bmxlc3MgQXJyYXkuaXNBcnJheSBhcnJcblx0XHRyZXR1cm4gY2I/IG5ldyBFcnJvciBcIk5vIDJEIGFycmF5XCIgaWYgYXJyLmxlbmd0aCBhbmQgbm90IEFycmF5LmlzQXJyYXkgYXJyWzBdXG5cdFx0YXN5bmMuZWFjaCBhcnIsICgoYSwgY2IpID0+IEBwc2V0IGFbMF0sIGFbMV0sIGNiKSwgKGVycm9yKSAtPlxuXHRcdFx0Y2I/IGVycm9yXG5cblx0IyBHZXQgYSB2YWx1ZSBieSBrZXlcblx0I1xuXHQjIEBwYXJhbSBbU3RyaW5nXSBQYXRoXG5cdCMgQHBhcmFtIFtGdW5jdGlvbl0gQ2FsbGJhY2sgZnVuY3Rpb25cblx0I1xuXHRsb2dNaXNzZWQ6IChwKSAtPlxuXHRcdGxvZy5kZWJ1ZyBcIiN7QGlkfTogbG9nTWlzc2VkXCIsIHBcblxuXHRcdGluZm8gPVxuXHRcdFx0cGF0aDogICAgICBwXG5cdFx0XHRyZWRpc0hvc3Q6IEByZWRpc0hvc3Rcblx0XHRcdHJlZGlzUG9ydDogQHJlZGlzUG9ydFxuXHRcdFx0aG9zdDogICAgICBAaG9zdFxuXHRcdFx0ZW52OiAgICAgICBAZW52XG5cdFx0XHRwcm9qZWN0OiAgIEBwcm9qZWN0XG5cdFx0XHR0aW1lOiAgICAgIG5ldyBEYXRlXG5cblx0XHRtaXNzZWRQYXRoRnVsbCA9IEBfY2xlYW5QYXRoIEBtaXNzZWRQYXRoXG5cblx0XHRAY2xpZW50LmxwdXNoIFttaXNzZWRQYXRoRnVsbCwgSlNPTi5zdHJpbmdpZnkgaW5mb10sIChlcnJvcikgPT5cblx0XHRcdHJldHVybiBsb2cuZXJyb3IgXCJFcnJvciBpbiBscHVzaDogI3tlcnJvci5tZXNzYWdlfVwiIGlmIGVycm9yXG5cblx0XHRcdEBlbWl0IFwibWlzc2VkXCIsIHAsIGluZm9cblxuXHRcdFx0QGNsaWVudC5sdHJpbSBbbWlzc2VkUGF0aEZ1bGwsIDAsIEBtaXNzZWRMZW5ndGggLSAxXSwgKGVycm9yKSA9PlxuXHRcdFx0XHRyZXR1cm4gbG9nLmVycm9yIFwiRXJyb3IgaW4gbHRyaW06ICN7ZXJyb3IubWVzc2FnZX1cIiBpZiBlcnJvclxuXG5cdCMgR2V0IGEgdmFsdWUgYnkga2V5XG5cdCNcblx0IyBAcGFyYW0gW1N0cmluZ10gUGF0aFxuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIENhbGxiYWNrIGZ1bmN0aW9uXG5cdCNcblx0Z2V0OiAocCwgY2IpIC0+XG5cdFx0cCA9IEBfY2xlYW5QYXRoIHBcblxuXHRcdEBjbGllbnQuZ2V0IHAsIChlcnJvciwgZGF0YSkgPT5cblx0XHRcdGxvZy5kZWJ1ZyBcIiN7QGlkfTogZ2V0XCIsIHBcblxuXHRcdFx0QGxvZ01pc3NlZCBwIHVubGVzcyBkYXRhXG5cblx0XHRcdGNiIGVycm9yLCBKU09OLnBhcnNlIGRhdGFcblxuXHQjIERlbGV0ZSBieSBrZXlcblx0I1xuXHQjIEBwYXJhbSBbU3RyaW5nXSBQYXRoXG5cdCMgQHBhcmFtIFtGdW5jdGlvbl0gQ2FsbGJhY2sgZnVuY3Rpb25cblx0I1xuXHRkZWw6IChwLCBjYikgLT5cblx0XHRwID0gQF9jbGVhblBhdGggcFxuXG5cdFx0QGNsaWVudC5rZXlzIFwiI3twfSpcIiwgKGVycm9yLCBrZXlzKSA9PlxuXHRcdFx0bG9nLmRlYnVnIFwiI3tAaWR9OiBrZXlzXCIsIFwiI3twfSpcIiwga2V5c1xuXHRcdFx0cmV0dXJuIGNiPyBlcnJvciBpZiBlcnJvclxuXG5cdFx0XHRhc3luYy5lYWNoU2VyaWVzIGtleXMsICgoaywgY2IpID0+XG5cdFx0XHRcdGNsZWFyVGltZW91dCBAZXBoZW1lcmFsc1trXVxuXG5cdFx0XHRcdEBjbGllbnQuZGVsIGssIChlcnJvciwgcmVzdWx0KSA9PlxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyBcIiN7QGlkfTogZGVsXCIsIGssIHJlc3VsdFxuXHRcdFx0XHRcdGNiIGVycm9yXG5cdFx0XHQpLCAoZXJyb3IpID0+XG5cdFx0XHRcdGNiPyBlcnJvclxuXG5cdCMgRGVsZXRlIG11bHRpcGxlIHBhdGhzXG5cdCNcblx0IyBAcGFyYW0gW0FycmF5XSBBcnJheSBvZiBwYXRoc1xuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIENhbGxiYWNrIGZ1bmN0aW9uXG5cdCNcblx0bWRlbDogKGtleXMsIGNiKSAtPlxuXHRcdHJldHVybiBjYj8gbmV3IEVycm9yIFwiTm8gYXJyYXlcIiB1bmxlc3MgQXJyYXkuaXNBcnJheSBrZXlzXG5cdFx0YXN5bmMuZWFjaCBrZXlzLCAoKGtleSwgY2IpID0+IEBkZWwga2V5LCBjYiksIChlcnJvcikgLT5cblx0XHRcdGNiPyBlcnJvclxuXG5cdCMgRXBoZW1lcmFsIHNldCBhIGtleS12YWx1ZVxuXHQjXG5cdCMgQHBhcmFtIFtTdHJpbmddIFJlbGF0aXZlIHBhdGhcblx0IyBAcGFyYW0gW2FueV0gRGF0YSB0byBiZSBzdG9yZWRcblx0IyBAcGFyYW0gW0Z1bmN0aW9uXSBDYWxsYmFjayBmdW5jdGlvblxuXHQjXG5cdHNldDogKHAsIGRhdGEsIGNiKSAtPlxuXHRcdHAgPSBAX2NsZWFuUGF0aCBwXG5cblx0XHRAY2xpZW50LnBzZXRleCBwLCBAZXBoZW1lcmFsRXhwaXJlLCBKU09OLnN0cmluZ2lmeShkYXRhKSwgKGVycm9yLCByZXN1bHQpID0+XG5cdFx0XHRsb2cuZGVidWcgXCIje0BpZH06IHNldGV4XCIsIHAsIEBlcGhlbWVyYWxFeHBpcmVcblx0XHRcdHJldHVybiBjYj8gZXJyb3IgaWYgZXJyb3JcblxuXHRcdFx0dXBkYXRlRXhwaXJlID0gPT5cblx0XHRcdFx0QGNsaWVudC5wZXhwaXJlIHAsIEBlcGhlbWVyYWxFeHBpcmUsIChlcnJvciwgcmVzdWx0KSA9PlxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyBcIiN7QGlkfTogZXhwaXJlXCIsIHAsIHJlc3VsdCwgQGVwaGVtZXJhbFJlZnJlc2hcblx0XHRcdFx0XHRyZXR1cm4gbG9nLmVycm9yIFwiRXJyb3Igc2V0dGluZyBleHBpcmUgb24gI3twfTogI3tlcnJvci5tZXNzYWdlfVwiIGlmIGVycm9yXG5cdFx0XHRcdFx0QGVwaGVtZXJhbHNbcF0gPSBzZXRUaW1lb3V0IHVwZGF0ZUV4cGlyZSwgQGVwaGVtZXJhbFJlZnJlc2hcblxuXHRcdFx0dXBkYXRlRXhwaXJlKClcblxuXHRcdFx0Y2I/KClcblxuXHQjIFNldCBtdWx0aXBsZSBrZXktdmFsdWVzXG5cdCNcblx0IyBAcGFyYW0gW0FycmF5XSBLZXktdmFsdWUgYXJyYXlcblx0IyBAcGFyYW0gW0Z1bmN0aW9uXSBDYWxsYmFjayBmdW5jdGlvblxuXHQjXG5cdG1zZXQ6IChhcnIsIGNiKSAtPlxuXHRcdHJldHVybiBjYj8gbmV3IEVycm9yIFwiTm8gMkQgYXJyYXlcIiB1bmxlc3MgQXJyYXkuaXNBcnJheSBhcnJcblx0XHRyZXR1cm4gY2I/IG5ldyBFcnJvciBcIk5vIDJEIGFycmF5XCIgaWYgYXJyLmxlbmd0aCBhbmQgbm90IEFycmF5LmlzQXJyYXkgYXJyWzBdXG5cblx0XHRhc3luYy5lYWNoIGFyciwgKChhLCBjYikgPT4gQHNldCBhWzBdLCBhWzFdLCBjYiksIChlcnJvcikgLT5cblx0XHRcdGNiPyBlcnJvclxuXG5cdCMgTGlzdCBhbGwgdmFsdWUgYnkgYSBwYXRoXG5cdCNcblx0IyBAcGFyYW0gW1N0cmluZ10gUGF0aFxuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIENhbGxiYWNrIGZ1bmN0aW9uXG5cdCNcblx0bGlzdDogKHAsIGNiKSAtPlxuXHRcdHAgPSBAX2NsZWFuUGF0aCBwXG5cdFx0cCA9IHAucmVwbGFjZSBcIipcIiwgXCJcIiBpZiBwLmxlbmd0aCAtIDEgaXMgcC5pbmRleE9mIFwiKlwiXG5cblx0XHRsb2cuZGVidWcgXCIje0BpZH06IGxpc3RcIiwgXCIje3B9KlwiXG5cblx0XHRAY2xpZW50LmtleXMgXCIje3B9KlwiLCAoZXJyb3IsIGtleXMpID0+XG5cdFx0XHRsb2cuZGVidWcgXCIje0BpZH06IGxpc3Qga2V5c1wiLCBcIiN7cH0qXCIsIGtleXNcblx0XHRcdHJldHVybiBjYiBlcnJvciBpZiBlcnJvclxuXG5cdFx0XHRrcyA9IFtdXG5cdFx0XHRmb3Iga2V5IGluIGtleXNcblx0XHRcdFx0a3MucHVzaCBrZXkucmVwbGFjZSBcIiN7QHJvb3RQYXRofS9cIiwgXCJcIlxuXG5cdFx0XHRjYiBudWxsLCBrc1xuXG5cdCMgUmVnaXN0ZXIgYSBzZXJ2aWNlXG5cdCNcblx0IyBAcGFyYW0gW1N0cmluZywgT2JqZWN0XSBSb2xlIG9yIG9iamVjdCB3aXRoIHJvbGUgYW5kIHBvcnRcblx0IyBAcGFyYW0gQm9vbGVhbiAgICAgICAgICBGb3JjZSB0aGUgZ2l2ZW4gcG9ydCBhbmQgZGlzYWJsZSBwb3J0IGNoZWNraW5nXG5cdCMgQHBhcmFtIFtGdW5jdGlvbl0gICAgICAgQ2FsbGJhY2sgZnVuY3Rpb25cblx0I1xuXHRyZWdpc3RlcjogKHJvbGUsIGZvcmNlUG9ydCwgY2IpIC0+XG5cdFx0bG9nLmRlYnVnIFwiI3tAaWR9OiByZWdpc3RlclwiLCByb2xlXG5cblx0XHR1bmxlc3MgY2Jcblx0XHRcdGNiICAgICAgICA9IGZvcmNlUG9ydFxuXHRcdFx0Zm9yY2VQb3J0ID0gZmFsc2VcblxuXHRcdGhvc3QgPSBAaG9zdFxuXHRcdGlmIHR5cGVvZiByb2xlIGlzICdvYmplY3QnXG5cdFx0XHRob3N0ID0gcm9sZS5ob3N0IG9yIGhvc3Rcblx0XHRcdHBvcnQgPSByb2xlLnBvcnRcblx0XHRcdHJvbGUgPSByb2xlLnJvbGVcblxuXHRcdEBnZXRQb3J0cyAoZXJyb3IsIHBvcnRzKSA9PlxuXHRcdFx0cmV0dXJuIGNiIGVycm9yIGlmIGVycm9yXG5cblx0XHRcdHVubGVzcyBmb3JjZVBvcnRcblx0XHRcdFx0d2hpbGUgbm90IHBvcnQ/IG9yIHBvcnQgaW4gcG9ydHNcblx0XHRcdFx0XHRwb3J0ID0gMTAwMDAgKyBNYXRoLmZsb29yIE1hdGgucmFuZG9tKCkgKiA1NTAwMFxuXG5cdFx0XHRAcHNldCBcInNlcnZpY2VzLyN7cm9sZX1cIiwgeyBob3N0OiBAaG9zdCwgcG9ydDogcG9ydCwgcm9sZTogcm9sZSB9LCAoZXJyb3IsIHN0YXQpID0+XG5cdFx0XHRcdGNiIGVycm9yLCBwb3J0XG5cblx0IyBGcmVlIGEgc2VydmljZSwgc2ltcGx5IGRlbGV0ZXMgYW5kIGVtaXRzIGEgZnJlZSBldmVudFxuXHQjXG5cdCMgQHBhcmFtIFtTdHJpbmcsIE9iamVjdF0gUm9sZSBvciBvYmplY3Qgd2l0aCByb2xlIGFuZCBwb3J0XG5cdCMgQHBhcmFtIFtGdW5jdGlvbl0gQ2FsbGJhY2sgZnVuY3Rpb25cblx0I1xuXHRmcmVlOiAocm9sZSwgY2IpIC0+XG5cdFx0bG9nLmRlYnVnIFwiI3tAaWR9OiBmcmVlXCIsIHJvbGVcblxuXHRcdHAgPSBAX2NsZWFuUGF0aCBcInNlcnZpY2VzLyN7cm9sZX1cIlxuXG5cdFx0QGdldCBwLCAoZXJyb3IsIHNlcnZpY2UpID0+XG5cdFx0XHRyZXR1cm4gY2I/IGVycm9yIGlmIGVycm9yXG5cblx0XHRcdEBkZWwgcCwgKGVycm9yKSAtPlxuXHRcdFx0XHRjYj8gZXJyb3IsIHNlcnZpY2VcblxuXHQjIFNldCBhIHdhdGNoIGZ1bmN0aW9uIG9uIGEgcm9sZVxuXHQjXG5cdCMgQHBhcmFtIFtTdHJpbmddIFJvbGUgbmFtZVxuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIFdhdGNoIGZ1bmN0aW9uLCBpcyBleGVjdXRlZCB3aGVuIHRoZSByb2xlIGlzIHNldFxuXHQjXG5cdHF1ZXJ5OiAocm9sZSwgcmVnRm4sIGZyZWVGbikgLT5cblx0XHRsb2cuZGVidWcgXCIje0BpZH06IHF1ZXJ5XCIsIHJvbGVcblxuXHRcdHByb2plY3QgPSB1bmRlZmluZWRcblx0XHRlbnYgICAgID0gdW5kZWZpbmVkXG5cblx0XHRpZiBfLmlzT2JqZWN0IHJvbGVcblx0XHRcdHByb2plY3QgPSByb2xlLnByb2plY3Rcblx0XHRcdGVudiAgICAgPSByb2xlLmVudlxuXHRcdFx0cm9sZSAgICA9IHJvbGUucm9sZVxuXG5cdFx0cCA9IEBfY2xlYW5QYXRoIFwic2VydmljZXMvI3tyb2xlfVwiLCBwcm9qZWN0LCBlbnZcblxuXHRcdHN1YnNjcmlwdGlvbktleSA9IFwiX19rZXlzcGFjZUAwX186I3twfVwiXG5cdFx0QHN1YnNjcmliZXIucHN1YnNjcmliZSBzdWJzY3JpcHRpb25LZXlcblxuXHRcdEBzdWJzY3JpcHRpb25zW3N1YnNjcmlwdGlvbktleV0gPVxuXHRcdFx0cGF0aDogICBwXG5cdFx0XHRyb2xlOiAgIHJvbGVcblx0XHRcdHJlZ0ZuOiAgcmVnRm5cblx0XHRcdGZyZWVGbjogZnJlZUZuXG5cblx0XHRpZiByb2xlLmxlbmd0aCAtIDEgaXMgcm9sZS5pbmRleE9mIFwiKlwiXG5cdFx0XHRAZ2V0U2VydmljZXMgcm9sZSwgKGVycm9yLCBzZXJ2aWNlcykgPT5cblx0XHRcdFx0cmV0dXJuIGxvZy5lcnJvciBcIiN7QGlkfTogRXJyb3IgZ2V0IHNlcnZpY2VzOiAje2Vycm9yLm1lc3NhZ2V9XCIgaWYgZXJyb3Jcblx0XHRcdFx0cmVnRm4gc2VydmljZSBmb3Igc2VydmljZSBpbiBzZXJ2aWNlc1xuXG5cdFx0ZWxzZVxuXHRcdFx0QGdldCBwLCAoZXJyb3IsIHNlcnZpY2UpID0+XG5cdFx0XHRcdHJldHVybiBsb2cuZXJyb3IgXCIje0BpZH06IEVycm9yIGdldDogI3tlcnJvci5tZXNzYWdlfVwiIGlmIGVycm9yXG5cdFx0XHRcdHJlZ0ZuIHNlcnZpY2UgaWYgc2VydmljZVxuXG5cdCMgVW53YXRjaCBhIHJvbGVcblx0I1xuXHQjIEBwYXJhbSBbU3RyaW5nXSBSb2xlIG5hbWVcblx0I1xuXHR1bnF1ZXJ5OiAocm9sZSkgLT5cblx0XHRsb2cuZGVidWcgXCIje0BpZH06IHVucXVlcnlcIiwgcm9sZVxuXG5cdFx0cHJvamVjdCA9IHVuZGVmaW5lZFxuXHRcdGVudiAgICAgPSB1bmRlZmluZWRcblxuXHRcdGlmIF8uaXNPYmplY3Qgcm9sZVxuXHRcdFx0cHJvamVjdCA9IHJvbGUucHJvamVjdFxuXHRcdFx0ZW52ICAgICA9IHJvbGUuZW52XG5cdFx0XHRyb2xlICAgID0gcm9sZS5yb2xlXG5cblx0XHRwID0gQF9jbGVhblBhdGggXCJzZXJ2aWNlcy8je3JvbGV9XCIsIHByb2plY3QsIGVudlxuXG5cdFx0c3Vic2NyaXB0aW9uS2V5ID0gXCJfX2tleXNwYWNlQDBfXzoje3B9XCJcblx0XHRAc3Vic2NyaWJlci5wdW5zdWJzY3JpYmUgc3Vic2NyaXB0aW9uS2V5XG5cblx0XHRkZWxldGUgQHN1YnNjcmlwdGlvbnNbc3Vic2NyaXB0aW9uS2V5XVxuXG5cdCMgR2V0IGN1cnJlbnQga25vd24gc2VydmljZXNcblx0I1xuXHQjIEBwYXJhbSBbU3RyaW5nXSBPcHRpb25hbCB3aWxkY2FyZCBzdHJpbmdcblx0IyBAcGFyYW0gW0Z1bmN0aW9uXSBDYWxsYmFjayBmdW5jdGlvblxuXHQjXG5cdGdldFNlcnZpY2VzOiAod2lsZGNhcmQsIGNiKSAtPlxuXHRcdHVubGVzcyBjYlxuXHRcdFx0Y2IgICAgICAgPSB3aWxkY2FyZFxuXHRcdFx0d2lsZGNhcmQgPSBudWxsXG5cblx0XHRxdWVyeVBhdGggID0gQHNlcnZpY2VzUGF0aFxuXHRcdHF1ZXJ5UGF0aCArPSBcIi8je3dpbGRjYXJkfVwiIGlmIHdpbGRjYXJkXG5cblx0XHRsb2cuZGVidWcgXCIje0BpZH06IGdldCBzZXJ2aWNlc1wiLCB3aWxkY2FyZCwgcXVlcnlQYXRoXG5cblx0XHRAbGlzdCBxdWVyeVBhdGgsIChlcnJvciwgcm9sZXMpID0+XG5cdFx0XHRyZXR1cm4gY2IgZXJyb3IgaWYgZXJyb3JcblxuXHRcdFx0c2VydmljZXMgPSBbXVxuXHRcdFx0YXN5bmMuZWFjaFNlcmllcyByb2xlcywgKChyb2xlLCBjYikgPT5cblx0XHRcdFx0QGdldCByb2xlLCAoZXJyb3IsIHMpID0+XG5cdFx0XHRcdFx0cmV0dXJuIGNiIGVycm9yIGlmIGVycm9yXG5cdFx0XHRcdFx0c2VydmljZXMucHVzaCBzXG5cdFx0XHRcdFx0Y2IoKVxuXHRcdFx0KSwgKGVycm9yKSA9PlxuXHRcdFx0XHRjYiBlcnJvciwgc2VydmljZXNcblxuXHQjIEdldCB0aGUgY3VycmVudCBhY3RpdmUgcG9ydHNcblx0I1xuXHQjIEBwYXJhbSBbRnVuY3Rpb25dIENhbGxiYWNrIGZ1bmN0aW9uXG5cdCNcblx0Z2V0UG9ydHM6IChjYikgLT5cblx0XHRsb2cuZGVidWcgXCIje0BpZH06IGdldCBwb3J0c1wiXG5cblx0XHRAZ2V0U2VydmljZXMgKGVycm9yLCBzZXJ2aWNlcykgPT5cblx0XHRcdHJldHVybiBjYiBlcnJvciBpZiBlcnJvclxuXG5cdFx0XHRwb3J0cyA9IF9cblx0XHRcdFx0LmNoYWluIHNlcnZpY2VzXG5cdFx0XHRcdC5maWx0ZXIgKHMpID0+IHMuaG9zdCBpcyBAaG9zdFxuXHRcdFx0XHQubWFwIChzKSAtPiBzLnBvcnRcblx0XHRcdFx0LnZhbHVlKClcblxuXHRcdFx0Y2IgbnVsbCwgcG9ydHNcblxuXHQjIFJldHVybnMgdGhlIGFic29sdXRlIHBhdGhcblx0I1xuXHQjIEBwYXJhbSBbU3RyaW5nXSBSZWxhdGl2ZSBvciBhYnNvbHV0ZSBwYXRoXG5cdCMgQHJldHVybiBbU3RyaW5nXSBBYnNvbHV0ZSBwYXRoXG5cdCNcblx0X2NsZWFuUGF0aDogKHAsIHByb2plY3QsIGVudikgLT5cblx0XHRwcm9qZWN0IG9yPSBAcHJvamVjdFxuXHRcdGVudiAgICAgb3I9IEBlbnZcblxuXHRcdHJvb3RQYXRoID0gXCIvI3tAcHJlZml4fS8je3Byb2plY3R9LyN7ZW52fVwiXG5cblx0XHRyZXR1cm4gcCBpZiAwIGlzIHAuaW5kZXhPZiByb290UGF0aFxuXHRcdHBhdGgucmVzb2x2ZSByb290UGF0aCwgcFxuXG5tb2R1bGUuZXhwb3J0cyA9IFJlZGlzUG9ydFxuIl19
