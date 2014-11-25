assert   = require "assert"
async    = require "async"
{ fork } = require "child_process"

RedisPort = require "../build/RedisPort"

clientNames = [
	"je-moeder"
	"je-vaderr"
	"je-zuster"
]

client = {}
service1 = "service-1"
service2 = "service-2"
reporter = null

listenOnceTo = (name, type, cb) ->
	unless client[name]
		throw new Error "`#{name}` does not exist in client collection"

	client[name].once "message", (msg) ->
		cb msg.data if msg.type is type

startClient = (name, cb) ->
	client[name] = fork "tools/client.js", [name]
	listenOnceTo name, "started", cb

registerClient = (role, cb) ->
	send = role

	if typeof role is 'object'
		port = role.port
		role = role.role
		send =
			role: role
			port: port

	listenOnceTo role, "registered", cb
	client[role].send
		type: "register"
		data: send

queryClient = (service, name, cb) ->
	listenOnceTo name, "queried", cb
	client[name].send
		type: "query"
		data: service

listenToPort = (port, name, cb) ->
	listenOnceTo name, "port", (p) ->
		assert.equal p, port
		cb()

printServices = (cb) ->
	return cb unless reporter

	reporter.getServices (error, services) ->
		throw error if error
		console.log ""
		if services.length
			console.log "#{s.host}\t#{s.port}\t#{s.role}" for s in services
		else
			console.log "No services!"
		console.log ""
		cb()

describe "Integration", ->
	describe "setup clients", ->
		before (done) ->
			reporter = new RedisPort
				redisHost: "localhost"
				redisPort: 6379
				host:      "localhost"
				project:   "project"
				env:       "development"
			reporter.on "started", done
			reporter.start()

		beforeEach (done) ->
			setTimeout done, 200

		after (done) ->
			@timeout 10000
			async.each Object.keys(client), ((name, cb) ->
				client[name].on "exit", (code) ->
					console.log "Client #{name}: Exitted."
					cb()
				client[name].kill()
			), ->
				setTimeout ->
					printServices ->
						reporter.stop()
						done()
				, 200

		afterEach (done) ->
			printServices done

		it "let's go! (initial timeout)", (done) ->
			setTimeout done, 1000

		it "start all clients", (done) ->
			async.each clientNames, startClient, done

		it "let the clients register itself", (done) ->
			async.each clientNames, registerClient, done()

		it "have all clients query for #{service1}", (done) ->
			async.each clientNames, queryClient.bind(null, service1), done

		it "start server #{service1}", (done) ->
			startClient service1, done

		it "register server #{service1} on 20000", (done) ->
			registerClient
				role: service1
				port: 20000
			, (p) ->
				assert.equal 20000, p
				setTimeout ->
					done()
				, 1000

		it "re-register server #{service1} on 30000", (done) ->
			registerClient
				role: service1
				port: 30000
			, (p) ->
				assert.equal 30000, p
				setTimeout ->
					done()
				, 1000

		it "re-register server #{service1} on 40000", (done) ->
			@timeout 5000

			async.each clientNames, listenToPort.bind(null, 40000), ->
				setTimeout ->
					done()
				, 1000

			setTimeout ->
				registerClient
					role: service1
					port: 40000
				, (p) ->
					assert.equal 40000, p
			, 1000

		it "start server #{service2}", (done) ->
			startClient service2, done

		it "register server #{service2} on 20000", (done) ->
			registerClient
				role: service2
				port: 20000
			, (p) ->
				assert.equal 20000, p
				done()

		it "have all clients query for #{service2}", (done) ->
			async.each clientNames, queryClient.bind(null, service2), done

		it "re-register server #{service2} on 30000", (done) ->
			registerClient
				role: service2
				port: 30000
			, (p) ->
				assert.equal 30000, p
				setTimeout ->
					done()
				, 1000

		it "re-register server #{service2} on 54321", (done) ->
			@timeout 5000

			async.each clientNames, listenToPort.bind(null, 54321), ->
				setTimeout ->
					done()
				, 1000

			setTimeout ->
				registerClient
					role: service1
					port: 54321
				, (p) ->
					assert.equal 54321, p
			, 1000

		it "close, exit and remove #{service2}", (done) ->
			client[service2].kill()
			delete client[service2]
			setTimeout ->
				done()
			, 500