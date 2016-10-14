_                = require "underscore"
assert           = require "assert"
async            = require "async"
path             = require "path"
redis            = require "redis"
{ EventEmitter } = require "events"

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
	ephemerals:       null

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

	# @property [String] Default path to missed keys
	missedPath:       "missed"

	# @property [String] Default lenth of missed keys list
	missedLength:     10000

	# @property [Object] Redis client to subscribe with
	subscriber:       null

	# @property [Object] Subscription registry
	subscriptions:    null

	# @property [Sting] Queue prefix
	queuePath:        "queue"

	# @property [Sting] Queue prefix
	queueRootPath:    null

	# @property [Sting] Max queue length
	queueMaxLength:   null

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
	constructor: (options, @id) ->
		{ @redisHost, @redisPort, @host, @env, @project } = options

		assert @[attr], "`#{attr}` is required" for attr in [
			"redisHost" # redis server hostname
			"redisPort" # redis server port
			"env"       # environment
			"host"      # client hostname
			"project"   # project name
		]

		@id or= Math.round Math.random() * 10000

		@ephemeralExpire  = options.ephemeralExpire  or @ephemeralExpire
		@ephemeralRefresh = options.ephemeralRefresh or @ephemeralRefresh
		@prefix           = options.prefix           or @prefix

		@rootPath      = "/#{@prefix}/#{@project}/#{@env}"
		@queueRootPath = @_cleanPath "queues"

	# Start function with callback
	#
	# @param [Function] Callback function
	#
	start: (cb) ->
		log.debug "#{@id}: connecting to #{@redisHost}:#{@redisPort}"

		@ephemerals    = {}
		@subscriptions = {}

		@subscriber = redis.createClient @redisPort, @redisHost

		@subscriber.on "pmessage", (pattern, channel, key) =>
			log.debug "#{@id}: pmessage", pattern, key

			switch key
				when "set"
					sub = @subscriptions[pattern]
					return log.debug "#{@id}: no subscription for #{pattern}" unless sub

					if pattern.length - 1 is pattern.indexOf "*"
						serviceRole = channel.replace "__keyspace@0__:", ""

						@get serviceRole, (error, service) ->
							return log.error "get error #{error.message}" if error

							sub.regFn? service

					else
						@get sub.path, (error, service) =>
							return log.error "get error #{error.message}" if error

							sub.regFn? service

				when "del"
					sub = @subscriptions[pattern]
					return log.debug "#{@id}: no subscription for #{pattern}" unless sub

					if pattern.length - 1 is pattern.indexOf "*"
						serviceRole = channel.replace "__keyspace@0__:", ""
						sub.freeFn? serviceRole.replace "#{@rootPath}/services/", ""
					else
						sub.freeFn? sub.role

		@subscriber.on "error", (error) =>
			log.warn "Redis client error: #{error.message}"
			@emit "reconnect"

		@client = redis.createClient @redisPort, @redisHost

		@client.once "connect", (error) =>
			log.debug "#{@id}: Connected."
			@emit "started"
			cb?()

		@client.on "error", (error) =>
			log.warn "Redis client error: #{error.message}"
			@emit "reconnect"

	# Stop the client
	#
	stop: (cb) ->
		log.debug "#{@id}: stopping"

		async.each (Object.keys @ephemerals or []), ((key, cb) =>
			clearTimeout @ephemerals[key]
			@del key, cb
		), =>
			@client?.end true
			@subscriber?.end true

			@emit "stopped"
			log.debug "#{@id}: stopped"

			cb?()

	# Sets the current queue name
	#
	# @param [Function] Callback function
	#
	clearQueue: (queue, cb) ->
		@client.del "#{@queueRootPath}/#{queue}", cb

	# Gets the current queue length
	#
	# @param [Function] Callback function
	#
	queueLength: (queue, cb) ->
		@client.llen "#{@queueRootPath}/#{queue}", cb

	# Add to the queue
	#
	# @param [String] Queue name
	# @param [Function] Callback function
	#
	enqueue: (queue, msg, cb) ->
		@client.lpush "#{@queueRootPath}/#{queue}", msg, (error, len) =>
			return cb error, len unless @queueMaxLength
			return cb error, len unless len > @queueMaxLength

			@client.ltrim ["#{@queueRootPath}/#{queue}", 0, @queueMaxLength - 2], (error) ->
				cb error, len

	# Get from the queue
	# This is blocking lpop, guarenteed to return a msg
	# Use only one instance of RedisPort for this
	#
	# @param [Function] Callback function
	#
	dequeue: (queue, cb) ->
		@client.brpop "#{@queueRootPath}/#{queue}", 0, (error, msg) ->
			cb error, msg[1]

	# Persistantly set a key-value
	#
	# @param [String] Relative path
	# @param [any] Data to store
	# @param [Function] Callback function
	#
	pset: (p, data, cb) ->
		p = @_cleanPath p
		@client.set p, JSON.stringify(data), (error, result) =>
			log.debug "#{@id}: set", p, result
			cb? error

	# Set array of persistant key-values
	#
	# @param [Array] Mutliple key-value combinations
	# @param [Function] Callback function
	#
	mpset: (arr, cb) ->
		return cb? new Error "No 2D array" unless Array.isArray arr
		return cb? new Error "No 2D array" if arr.length and not Array.isArray arr[0]
		async.each arr, ((a, cb) => @pset a[0], a[1], cb), (error) ->
			cb? error

	# Get a value by key
	#
	# @param [String] Path
	# @param [Function] Callback function
	#
	logMissed: (p) ->
		log.debug "#{@id}: logMissed", p

		info =
			path:      p
			redisHost: @redisHost
			redisPort: @redisPort
			host:      @host
			env:       @env
			project:   @project
			time:      new Date

		missedPathFull = @_cleanPath @missedPath

		@client.lpush [missedPathFull, JSON.stringify info], (error) =>
			return log.error "Error in lpush: #{error.message}" if error

			@emit "missed", p, info

			@client.ltrim [missedPathFull, 0, @missedLength - 1], (error) =>
				return log.error "Error in ltrim: #{error.message}" if error

	# Get a value by key
	#
	# @param [String] Path
	# @param [Function] Callback function
	#
	get: (p, cb) ->
		p = @_cleanPath p

		@client.get p, (error, data) =>
			log.debug "#{@id}: get", p

			@logMissed p unless data

			cb error, JSON.parse data

	# Delete by key
	#
	# @param [String] Path
	# @param [Function] Callback function
	#
	del: (p, cb) ->
		p = @_cleanPath p

		@client.keys "#{p}*", (error, keys) =>
			log.debug "#{@id}: keys", "#{p}*", keys
			return cb? error if error

			async.eachSeries keys, ((k, cb) =>
				clearTimeout @ephemerals[k]

				@client.del k, (error, result) =>
					log.debug "#{@id}: del", k, result
					cb error
			), (error) =>
				cb? error

	# Delete multiple paths
	#
	# @param [Array] Array of paths
	# @param [Function] Callback function
	#
	mdel: (keys, cb) ->
		return cb? new Error "No array" unless Array.isArray keys
		async.each keys, ((key, cb) => @del key, cb), (error) ->
			cb? error

	# Ephemeral set a key-value
	#
	# @param [String] Relative path
	# @param [any] Data to be stored
	# @param [Function] Callback function
	#
	set: (p, data, cb) ->
		p = @_cleanPath p

		@client.psetex p, @ephemeralExpire, JSON.stringify(data), (error, result) =>
			log.debug "#{@id}: setex", p, @ephemeralExpire
			return cb? error if error

			updateExpire = =>
				@client.pexpire p, @ephemeralExpire, (error, result) =>
					log.debug "#{@id}: expire", p, result, @ephemeralRefresh
					return log.error "Error setting expire on #{p}: #{error.message}" if error
					@ephemerals[p] = setTimeout updateExpire, @ephemeralRefresh

			updateExpire()

			cb?()

	# Set multiple key-values
	#
	# @param [Array] Key-value array
	# @param [Function] Callback function
	#
	mset: (arr, cb) ->
		return cb? new Error "No 2D array" unless Array.isArray arr
		return cb? new Error "No 2D array" if arr.length and not Array.isArray arr[0]

		async.each arr, ((a, cb) => @set a[0], a[1], cb), (error) ->
			cb? error

	# List all value by a path
	#
	# @param [String] Path
	# @param [Function] Callback function
	#
	list: (p, cb) ->
		p = @_cleanPath p
		p = p.replace "*", "" if p.length - 1 is p.indexOf "*"

		log.debug "#{@id}: list", "#{p}*"

		@client.keys "#{p}*", (error, keys) =>
			log.debug "#{@id}: list keys", "#{p}*", keys
			return cb error if error

			ks = []
			for key in keys
				ks.push key.replace "#{@rootPath}/", ""

			cb null, ks

	# Register a service
	#
	# @param [String, Object] Role or object with role and port
	# @param Boolean          Force the given port and disable port checking
	# @param [Function]       Callback function
	#
	register: (role, forcePort, cb) ->
		log.debug "#{@id}: register", role

		unless cb
			cb        = forcePort
			forcePort = false

		host = @host
		if typeof role is 'object'
			host = role.host or host
			port = role.port
			role = role.role

		@getPorts (error, ports) =>
			return cb error if error

			unless forcePort
				while not port? or port in ports
					port = 10000 + Math.floor Math.random() * 55000

			@pset "services/#{role}", { host: @host, port: port, role: role }, (error, stat) =>
				cb error, port

	# Free a service, simply deletes and emits a free event
	#
	# @param [String, Object] Role or object with role and port
	# @param [Function] Callback function
	#
	free: (role, cb) ->
		log.debug "#{@id}: free", role

		p = @_cleanPath "services/#{role}"

		@get p, (error, service) =>
			return cb? error if error

			@del p, (error) ->
				cb? error, service

	# Set a watch function on a role
	#
	# @param [String] Role name
	# @param [Function] Watch function, is executed when the role is set
	#
	query: (role, regFn, freeFn) ->
		log.debug "#{@id}: query", role

		project = undefined
		env     = undefined

		if _.isObject role
			project = role.project
			env     = role.env
			role    = role.role

		p = @_cleanPath "services/#{role}", project, env

		subscriptionKey = "__keyspace@0__:#{p}"
		@subscriber.psubscribe subscriptionKey

		@subscriptions[subscriptionKey] =
			path:   p
			role:   role
			regFn:  regFn
			freeFn: freeFn

		if role.length - 1 is role.indexOf "*"
			@getServices role, (error, services) =>
				return log.error "#{@id}: Error get services: #{error.message}" if error
				regFn service for service in services

		else
			@get p, (error, service) =>
				return log.error "#{@id}: Error get: #{error.message}" if error
				regFn service if service

	# Unwatch a role
	#
	# @param [String] Role name
	#
	unquery: (role) ->
		log.debug "#{@id}: unquery", role

		project = undefined
		env     = undefined

		if _.isObject role
			project = role.project
			env     = role.env
			role    = role.role

		p = @_cleanPath "services/#{role}", project, env

		subscriptionKey = "__keyspace@0__:#{p}"
		@subscriber.punsubscribe subscriptionKey

		delete @subscriptions[subscriptionKey]

	# Get current known services
	#
	# @param [String] Optional wildcard string
	# @param [Function] Callback function
	#
	getServices: (wildcard, cb) ->
		unless cb
			cb       = wildcard
			wildcard = null

		queryPath  = @servicesPath
		queryPath += "/#{wildcard}" if wildcard

		log.debug "#{@id}: get services", wildcard, queryPath

		@list queryPath, (error, roles) =>
			return cb error if error

			services = []
			async.eachSeries roles, ((role, cb) =>
				@get role, (error, s) =>
					return cb error if error
					services.push s
					cb()
			), (error) =>
				cb error, services

	# Get the current active ports
	#
	# @param [Function] Callback function
	#
	getPorts: (cb) ->
		log.debug "#{@id}: get ports"

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
	_cleanPath: (p, project, env) ->
		project or= @project
		env     or= @env

		rootPath = "/#{@prefix}/#{project}/#{env}"

		return p if 0 is p.indexOf rootPath
		path.resolve rootPath, p

module.exports = RedisPort
