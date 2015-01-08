assert           = require "assert"
async            = require "async"
{ EventEmitter } = require "events"
path             = require "path"
redis            = require "redis"
_                = require "underscore"

log = require "./log"

# Service registry and port assignment using Redis
#
# Creates two redis clients to support
# - Key space notification subscriptions
# - Ephemeral network storage
#
class RedisPort extends EventEmitter
	# @property [Object] Redis client to set/get with
	client:           null

	# @property [Object] Interval collection the resets the expire flags
	ephemerals:       {}

	# @property [Number] Milliseconds to expire
	ephemeralExpire:  15000

	# @property [Number] Milliseconds to reset expire
	ephemeralRefresh: 10000

	# @property [String] Main prefix
	prefix:           "redis-port"

	# @property [String] The extended prefix of each key
	rootPath:         null

	# @property [String] Default path to subscribe network services with
	servicesPath:     "services"

	# @property [Object] Redis client to subscribe with
	subscriber:       null

	# @property [Object] Subscription registry
	subscriptions:    {}

	# @property [Object] Wildcard queries
	wildcards:        {}

	# Constructor
	#
	# @param options [Object] Main options
	# @option redisHost [String] Hostname of Redis service
	# @option redisPort [Number] Port of Redis service
	# @option host [String] Hostname of the current machine
	# @option env [String] Environment
	# @option project [String] Project name
	# @option prefix [String] Main prefix
	#
	constructor: (options) ->
		{ @redisHost, @redisPort, @host, @env, @project } = options

		assert @[attr], "`#{attr}` is required" for attr in [
			"redisHost" # redis server hostname
			"redisPort" # redis server port
			"env"       # environment
			"host"      # client hostname
			"project"   # project name
		]

		@ephemeralExpire  = options.ephemeralExpire  or @ephemeralExpire
		@ephemeralRefresh = options.ephemeralRefresh or @ephemeralRefresh
		@prefix           = options.prefix           or @prefix

		@rootPath = "/#{@prefix}/#{@project}/#{@env}"

	# Start function with callback
	#
	# @param [Function] Callback function
	#
	start: (cb) ->
		log.debug "redis-port: Connecting to #{@redisHost}:#{@redisPort}"

		@subscriber = redis.createClient @redisPort, @redisHost, retry_max_delay: 10000

		@subscriber.on "pmessage", (pattern, channel, key) =>
			log.debug "pmessage", pattern, key
			sub = @subscriptions[pattern]
			return log.debug "No subscription for #{pattern}" unless sub

			switch key
				when "set"
					@get sub.path, (error, service) =>
						return log.error "redis-port: Get error #{error.message}" if error

						sub.fn service
				# when "expired"

		@subscriber.on "error", (error) =>
			log.warn "redis-port: Redis client error: #{error.message}"
			@emit "reconnect"

		@client = redis.createClient @redisPort, @redisHost, retry_max_delay: 10000

		@client.once "connect", (error) =>
			log.debug "redis-port: Connected."
			@emit "started"
			cb?()

		@client.on "error", (error) =>
			log.warn "redis-port: Redis client error: #{error.message}"
			@emit "reconnect"

	# Stop the client
	#
	stop: ->
		@client.quit()
		@subscriber.quit()
		@emit "stopped"

	# Persistantly set a key-value
	#
	# @param [String] Relative path
	# @param [any] Data to store
	# @param [Function] Callback function
	#
	pset: (p, data, cb) ->
		p = @_cleanPath p
		@client.set p, JSON.stringify(data), (error, result) ->
			log.debug "set", p, result
			return cb error if error
			cb()

	# Set array of persistant key-values
	#
	# @param [Array] Mutliple key-value combinations
	# @param [Function] Callback function
	#
	mpset: (arr, cb) ->
		return cb new Error "No 2D array" unless Array.isArray arr
		return cb new Error "No 2D array" if arr.length and not Array.isArray arr[0]
		async.each arr, ((a, cb) => @pset a[0], a[1], cb), cb

	# Get a value by key
	#
	# @param [String] Path
	# @param [Function] Callback function
	#
	get: (p, cb) ->
		p = @_cleanPath p

		@client.get p, (error, data) ->
			log.debug "get", p
			return cb error if error
			cb null, JSON.parse data

	# Delete by key
	#
	# @param [String] Path
	# @param [Function] Callback function
	#
	del: (p, cb) ->
		p = @_cleanPath p

		@client.keys "#{p}*", (error, keys) =>
			log.debug "keys", "#{p}*", keys
			return cb error if error

			async.eachSeries keys, ((k, cb) =>
				clearTimeout @ephemerals[k]

				@client.del k, (error, result) =>
					log.debug "del", k, result
					return cb error if error
					cb()
			), (error) =>
				return cb error if error
				cb()

	# Delete multiple paths
	#
	# @param [Array] Array of paths
	# @param [Function] Callback function
	#
	mdel: (keys, cb) ->
		return cb new Error "No array" unless Array.isArray keys
		async.each keys, ((key, cb) => @del key, cb), cb

	# Ephemeral set a key-value
	#
	# @param [String] Relative path
	# @param [any] Data to be stored
	# @param [Function] Callback function
	#
	set: (p, data, cb) ->
		p = @_cleanPath p

		@client.psetex p, @ephemeralExpire, JSON.stringify(data), (error, result) =>
			log.debug "setex", p, @ephemeralExpire
			return cb error if error

			updateExpire = =>
				@client.pexpire p, @ephemeralExpire, (error, result) =>
					log.debug "expire", p, result, @ephemeralRefresh
					return log.error "Error setting expire on #{p}: #{error.message}" if error
					@ephemerals[p] = setTimeout updateExpire, @ephemeralRefresh

			updateExpire()

			cb()

	# Set multiple key-values
	#
	# @param [Array] Key-value array
	# @param [Function] Callback function
	#
	mset: (arr, cb) ->
		return cb new Error "No 2D array" unless Array.isArray arr
		return cb new Error "No 2D array" if arr.length and not Array.isArray arr[0]

		async.each arr, ((a, cb) => @set a[0], a[1], cb), cb

	# List all value by a path
	#
	# @param [String] Path
	# @param [Function] Callback function
	#
	list: (p, cb) ->
		p = @_cleanPath p

		@client.keys "#{p}*", (error, keys) =>
			log.debug "keys", "#{p}*", keys
			return cb error if error

			ks = []
			for key in keys
				ks.push key.replace "#{@rootPath}/", ""

			cb null, ks

	checkWildcard: (role, cb) ->
		wildcardKey = _.chain @wildcards
			.keys()
			.find (w) -> role.match new RegExp w
			.value()

		return cb() unless wildcardKey

		@addSubscription role, @wildcards[wildcardKey].fn

		cb()

	# Register a service
	#
	# @param [String, Object] Role or object with role and port
	# @param [Function] Callback function
	#
	register: (role, cb) ->
		if typeof role is 'object'
			port = role.port
			role = role.role

		@getPorts (error, ports) =>
			return cb error if error

			while not port? or port in ports
				port = 10000 + Math.floor Math.random() * 55000

			@set "services/#{role}", { host: @host, port: port, role: role }, (error, stat) =>
				return cb error if error

				@checkWildcard role, (error) =>
					return cb error if error

					cb null, port

	# Free a service, simply deletes and emits a free event
	#
	# @param [String, Object] Role or object with role and port
	# @param [Function] Callback function
	#
	free: (role, cb) ->
		p = @_cleanPath "services/#{role}"

		@get p, (error, service) =>
			return cb error if error

			@del role, (error) ->
				return cb error if error
				cb()

	# Add a subscription on a role
	#
	# @param [String] Role name
	# @param [Function] Watch function, is executed when the role is set
	#
	addSubscription: (role, fn) =>
		p = @_cleanPath "services/#{role}"

		subscriptionKey = "__keyspace@0__:#{p}"
		@subscriber.psubscribe subscriptionKey
		log.debug "Subscribing to #{p}"

		@subscriptions[subscriptionKey] = path: p, fn: fn, role: role

		@get p, (error, service) =>
			fn service if not error and service

	# Set a watch function on a role
	#
	# @param [String] Role name
	# @param [Function] Watch function, is executed when the role is set
	#
	query: (role, fn) ->
		if role.length - 1 isnt role.indexOf "*"
			# no wildcard
			@addSubscription role, fn

		else
			# wildcard
			wildcard = role.replace "*", ""

			@getServices wildcard, (error, services) =>
				for service in services
					@addSubscription service.role, fn

					role = role.replace "*", ""
					unless @wildcards[role]
						@wildcards[role] =
							fn:    fn
							roles: []

					unless service.role in @wildcards[role].roles
						@wildcards[role].roles.push service.role

	# Get current known services
	#
	# @param [String] Optional wildcard string
	# @param [Function] Callback function
	#
	getServices: (wildcard, cb) ->
		unless cb
			cb       = wildcard
			wildcard = ""

		@list "#{@servicesPath}/#{wildcard}", (error, roles) =>
			return cb error if error

			services = []
			async.eachSeries roles, ((role, cb) =>
				@get role, (error, s) =>
					return cb error if error
					services.push s
					cb()
			), (error) =>
				return cb error if error
				cb null, services

	# Get the current active ports
	#
	# @param [Function] Callback function
	#
	getPorts: (cb) ->
		@getServices (error, services) =>
			return cb error if error

			ports = _
				.chain services
				.filter (s) => s.host is @host
				.map (s) -> s.port
				.value()

			cb null, ports

	# Returns the absolute path
	#
	# @param [String] Relative or absolute path
	# @return [String] Absolute path
	#
	_cleanPath: (p) ->
		return p if 0 is p.indexOf @rootPath
		resolvedPath = path.resolve @rootPath, p

module.exports = RedisPort
