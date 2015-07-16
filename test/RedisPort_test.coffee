_      = require "underscore"
async  = require "async"
assert = require "assert"

RedisPort = require "../src/RedisPort"

newClient = (p, id, cb) ->
	p or= "undisclosed#{Math.round Math.random() * 100}"

	rpc = new RedisPort
		redisHost: "localhost"
		redisPort: 6379
		host:      "localhost"
		project:   p
		env:       "development"
	, id

	rpc.start ->
		cb rpc

client = null

describe "Unit", ->

	describe "not running", ->
		it "should wait or retry", (done) ->
			client = new RedisPort
				redisHost: "localhost"
				# redisPort: 6380
				redisPort: 6380
				project:   "vems"
				env:       "production"
				host:      "localhost"
			count = 0
			client.on "reconnect", ->
				if ++count is 3
					client.stop()
					done()
			client.start()

	describe "connect to runnning service", ->
		it "should connect", (done) ->
			newClient null, null, (c) ->
				client = c
				done()

	describe "basic redis functioniality", ->
		p = "deltest"
		d = "hejejee"
		describe "pset", ->
			it "should work", (done) ->
				client.pset p, d, (error) ->
					throw error if error
					done()

		describe "pmset", ->
			it "should work", (done) ->
				client.mpset [
					["jo", "ja"]
					["je", "ho"]
					["li", "lo"]
				], (error) ->
					throw error if error
					done()

		describe "list", ->
			it "should list", (done) ->
				client.list "", (error, list) ->
					throw error if error
					async.each ["li", "je", "jo", "deltest"], ((el, cb) ->
						assert el in list
						cb()
					), (error) ->
						throw error if error
						done()

		describe "get", ->
			it "existant get", (done) ->
				client.get p, (error, data) ->
					throw error if error
					assert data, d
					done()

		describe "del", ->
			it "existant", (done) ->
				client.del p, (error) ->
					throw error if error
					done()

			it "non-existant", (done) ->
				client.del p, (error) ->
					throw error if error
					done()

		describe "mdel", ->
			it "should do it", (done) ->
				client.mdel ["li", "je", "jo", "deltest"], (error) ->
					throw error if error
					done()

		describe "get", ->
			it "non-existant get", (done) ->
				client.get p, (error, data) ->
					throw error if error
					assert.equal data, null
					done()

		describe "recursive delete a list", ->
			path = "jahah"

			before (done) ->
				async.each [
					"#{path}/je-vader"
					"#{path}/je-moeder"
					"#{path}/je-moeder/hihih"
					"#{path}/je-moeder/lalala"
					"#{path}"
					"#{path}/je-moeder/lalala/jan"
					"#{path}/hersen"
					"#{path}/hersen/hans"
				], ((p, cb) -> client.pset p, "some data", cb), (error) ->
					throw error if error
					done()

			it "should delete recursively", (done) ->
				client.del path, (error) ->
					throw error if error
					done()

		describe "recursive delete an awkward list", ->
			path = "jahah"

			paths = [
				path
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/jo/mamma/hake"
				"#{path}/bla/lalala/jan"
				"#{path}/sd"
				"#{path}/adsf"
				"#{path}/sdas/asdfasdf/asd"
				"#{path}/jo/mamma/hake"
				"#{path}/sd/asdf"
				"#{path}/hehehe/ja-toch/das-gek"
				"#{path}/hehehe"
			]

			it "do it", (done) ->
				async.each paths, ((p, cb) -> client.pset p, "some data", cb), (error) ->
					throw error if error
					client.del path, (error) ->
						throw error if error
						done()

	describe "ephemeral storage", ->
		before (done) ->
			client = new RedisPort
				redisHost: "localhost"
				redisPort: 6379
				host:      "localhost"
				project:   "hmmbob"
				env:       "development"
				ephemeralExpire:  150
				ephemeralRefresh: 100
			client.start ->
				done()

		describe "set", ->
			it "should set a key and update the expired flag", (done) ->
				client.set "some", "data", (error) ->
					throw error if error
					done()

		describe "delete", ->
			it "should be deleted without an error and delete the timeout", (done) ->
				setTimeout ->
					client.del "some", (error) ->
						throw error if error
						client.get "some", (error, data) ->
							throw error if error
							assert.equal null, data
							done()
				, 10
				client.get "some", (error, data) ->
					throw error if error
					assert data

	describe "reconnect", ->
		ephemerals = [
			["someWhere", "a"]
			["someHere",  "b"]
			["someThere", "c"]
		]

		describe "all ephemeral is gone", ->
			it "set some last ephemerals", (done) ->
				client.mset ephemerals, (error) ->
					client.list "", (error, list) ->
						throw error if error
						async.each ["someWhere", "someHere", "someThere"], ((el, cb) ->
							assert el in list
							cb()
						), (error) ->
							throw error if error
							done()

			it "new client", (done) ->
				client.on "stopped", ->
					newClient null, null, (c) ->
						client = c
						done()
				client.stop()

			it "list", (done) ->
				client.list "", (error, list) ->
					for e in ephemerals
						assert e[0] not in list
					done()

	describe "services", ->
		before (done) ->
			client.on "stopped", ->
				newClient null, null, (c) ->
					client = c
					setTimeout ->
						done()
					, 1000
			client.stop()

		services = [
			{ host: "leo",       port: 20000, role: "bla"    }
			{ host: "fatima",    port: 20000, role: "blaiep" }
			{ host: "localhost", port: 20000, role: "jan"    }
			{ host: "localhost", port: 30000, role: "hans"   }
			{ host: "localhost", port: 40000, role: "ferry" }
		]

		describe "get ports - filled", ->

			it "first set some data", (done) ->
				async.each services, ((s, cb) ->
					client.set "services/#{s.role}", s, cb
				), (error) ->
					client.list "services", (error, list) ->
						throw error if error
						async.each services.map((s) -> s.role), ((role, cb) ->
							assert "services/#{role}" in list
							cb()
						), (error) ->
							throw error if error
							done()

			it "get services", (done) ->
				client.getServices (error, list) ->
					throw error if error
					async.each services.map((s) -> s.role), ((role, cb) ->
						assert role in list.map((s) -> s.role)
						cb()
					), (error) ->
						throw error if error
						done()

			it "should get the services ports (filled)", (done) ->
				client.getPorts (error, ports) ->
					throw error if error

					throw error if error
					async.each [20000, 30000, 40000], ((port, cb) ->
						assert port in ports
						cb()
					), (error) ->
						throw error if error
						done()

		describe "register a service by role", ->
			it "should register a service by name", (done) ->
				client.register "some-unique-service", (error, port) ->
					throw error if error
					client.getPorts (error, ports) ->
						return error if error
						assert port in ports
						assert not (port in services.map (s) -> s.port)
						done()

			it "should register a service by object", (done) ->
				client.register
					role: "queue1"
					host: "natje",
					port: 6379
				, (error, port) ->
					throw error if error

					client.register
						role: "queue2"
						host: "natje",
						port: 6379
					, (error, port) ->
						client.getServices (error, list) ->
							assert.equal 2, (_.filter list, (s) -> s.port is 6379).length
							done()

			it "should be listed with a wildcard", (done) ->
				client.getServices "some", (error, services) ->
					throw error if error
					assert services.length
					assert.equal "some-unique-service", services[0].role
					done()

		describe "Query tests", ->

			it "Query with a non exsisting role, should not trigger onData", (done) ->
				count = 0

				client.query "GekkeGerrit", (data) ->
					assert data
					done() if ++count is 1

				client.register "GekkeGerrit", (error, port) ->
					throw error if error

			it "Query and free", (done) ->
				count = 0
				client.query "Harry", ((data) ->
					client.free "Harry", (error, service) ->
						throw error if error

						assert.equal "Harry", service.role
				), (data) ->
					done() if ++count is 1

				client.register "Harry", (error, port) ->
					throw error if error

			it "Query and free - wildcard", (done) ->
				roles = ["Harry-1", "Harry-2", "Harry-3"]

				count = 0
				client.query "Harry*", ((data) ->
					client.free "Harry*", (error, service) ->
						throw error if error
				), (role) ->
					assert role in roles
					done() if ++count is 3

				async.each roles, ((role, cb) ->
					client.register role, (error, port) ->
						throw error if error
				)

			it "should trigger onData 4 times after issueing a single query", (done) ->
				@timeout 100000
				role = "web"
				count = 0

				onData = (service) ->
					assert service.role is "web"
					assert service.host is "localhost"
					done() if count++ is 4

				client.query role, onData

				functions = for i in [1..5]
					(cb) ->
						client.register role, (error, port) ->
							return cb error if error
							setTimeout cb, 100

				async.series functions, (error) ->
					throw error if error

			it "should trigger a wildcard - existing services", (done) ->
				services = [
					"listener-hy_001-raw"
					"listener-hy_002-raw"
					"listener-hy_003-raw"
				]
				async.map services, ((role, cb) -> client.register role, cb), (error, ports) ->
					throw error if error

					assert.equal 3, ports.length

					count   = 0
					timeout = null

					client.query "listener*", (service) ->
						assert (service.role in services)
						done() if ++count is 3

			it "should trigger a wildcard - existing and added services", (done) ->

				async.map ["1", "2", "3"], ((vid, cb) ->
					client.register "bladieblaat-#{vid}", cb
				), (error, ports) ->
					throw error if error

					assert.equal 3, ports.length

					count   = 0
					client.query "bladieblaat*", (service) ->
						assert 0 is service.role.indexOf "bladieblaat"
						done() if ++count is 6

					async.map ["4", "5", "6"], ((vid, cb) ->
						client.register "bladieblaat-#{vid}", cb
					), (error, ports) ->
						throw error if error
						assert.equal 3, ports.length

	describe "2 clients on the same project", ->
		it "should get notified of each others registerd services", (done) ->
			newClient "same-project", "client-a", (clientA) ->
				newClient "same-project", "client-b", (clientB) ->
					clientA.query "spawner*", (service) ->
						assert service
						assert.equal "spawner-hy_001-raw", service.role
						clientA.stop ->
							done()

					clientB.register "spawner-hy_001-raw", (error, port) ->
						throw error if error

	describe "2 clients on one redis-port host", ->
		describe "two seperate clients should not interfere", ->

			it "create services on client1", (done) ->

				wildcard = "bladiebap"
				vids = ["yoy_001", "yoy_002", "yoy_003"]

				count = 0
				onRegister1 = (p) ->
					done() if ++count is 3

				onRegister2 = ->
					throw new Error "Callback of client 2 was called!"

				newClient "nice-project-1", "client1", (c) ->
					client1 = c

					client1.getServices (error, list) ->
						throw error if error

						client1.del "services", (error) ->
							throw error if error

							newClient "nice-project-2", "client2", (c) ->
								client2 = c

								client1.query "#{wildcard}*", onRegister1
								client2.query "#{wildcard}*", onRegister2

								async.map vids, ((vid, cb) ->
									client1.register "#{wildcard}-#{vid}-raw", cb
								), (error, ports) ->
									throw error if error

	describe 'queues', ->
		queue = "testlist"
		rpc   = null


		beforeEach (done) ->
			newClient "nice-project-1", "client1", (c) ->
				rpc = c

				rpc.clearQueue queue, (error) ->
					throw error if error
					done()

		afterEach (done) ->
			rpc.clearQueue queue, (error) ->
				throw error if error
				done()

		describe "size", ->
			it 'should return the initial length of the redis enqueue which is zero', (done) ->
				rpc.queueLength queue, (err, size) ->
					assert.equal size, 0
					done()

		describe 'enqueue', ->
			it 'should enqueue 10 items and return length of 10', (done) ->
				llen = 0
				async.eachSeries [1..10], (i, cb) ->
					rpc.enqueue queue, "sasads", (error, l) ->
						throw error if error
						llen = l
						cb()
				, (error) ->
					throw error if error

					assert.equal 10, llen

					done()

			it 'should enqueue 10 items in expected order', (done) ->
				async.eachSeries [0..10], ((i, cb) ->
					rpc.enqueue queue, JSON.stringify({i: i, c: i}), cb
				), ->
					path = rpc._cleanPath("queues/#{queue}")
					console.log path

					rpc.client.lrange rpc._cleanPath("queues/#{queue}"), 0, 10, (error, arr) ->
						assert.equal "#{arr.join(",")}", '{"i":0,"c":0},{"i":1,"c":1},{"i":2,"c":2},{"i":3,"c":3},{"i":4,"c":4},{"i":5,"c":5},{"i":6,"c":6},{"i":7,"c":7},{"i":8,"c":8},{"i":9,"c":9},{"i":10,"c":10}'
						done()

			it 'should enqueue 10 items and dequeue in expected order', (done) ->
				async.eachSeries [0..20], ((i, cb) ->
					rpc.enqueue queue, JSON.stringify({i: i, c: i}), cb
				), ->
					arr = []
					async.eachSeries [0..10], ((i, cb) ->
						rpc.dequeue queue, (error, msg) ->
							arr.push msg
							cb()
					), ->
						assert.equal "#{arr.join(",")}", '{"i":0,"c":0},{"i":1,"c":1},{"i":2,"c":2},{"i":3,"c":3},{"i":4,"c":4},{"i":5,"c":5},{"i":6,"c":6},{"i":7,"c":7},{"i":8,"c":8},{"i":9,"c":9},{"i":10,"c":10}'
						done()

		describe 'dequeue', ->
			it 'should enqueue and dequeue 10 items and return length of 0', (done) ->
				@timeout 10000

				llen   = 0
				amount = 1000

				async.eachSeries [1..amount], (i, cb) ->
					rpc.enqueue queue, JSON.stringify({ha: "sdfsdsdfsdf", d: "sdfsdfsdfsdfsdf", t: 12321321354}), (error, l) ->
						throw error if error
						llen = l
						cb()
				, (error) ->
					throw error if error

					assert.equal amount, llen

					async.eachSeries [1..amount], (i, cb) ->
							rpc.dequeue queue, (err, msg) ->
								throw err if err
								llen--
								cb()
					, () ->
						assert.equal llen, 0
						done()

		describe 'maxlength', ->
			it 'should not go over max length', (done) ->
				@timeout 10000
				rpc.queueMaxLength = 10

				llen = 0

				async.eachSeries [1..1000], (i, cb) ->
					rpc.enqueue queue, JSON.stringify({ha: "sdfsdsdfsdf", d: "sdfsdfsdfsdfsdf", t: 12321321354}), (error, l) ->
						throw error if error
						llen = l
						cb()
				, (error) ->
					throw error if error

					setTimeout ->
						assert.equal llen, 10
						done()
					, 2000



