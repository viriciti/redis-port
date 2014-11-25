async  = require "async"
assert = require "assert"

RedisPort = require "../src/RedisPort"

newClient = (p, cb) ->
	unless cb
		cb = p
		p  = "undisclosed"

	rpc = new RedisPort
		redisHost: "localhost"
		redisPort: 9090
		host:      "localhost"
		project:   p
		env:       "development"
	rpc.start ->
		cb rpc

describe "Unit", ->
	client = null

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
			newClient (c) ->
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
				redisPort: 9090
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

	describe "reconnect", ->
		describe "all ephemeral is gone", ->
			it "set some last ephemerals", (done) ->
				client.mset [
					["someWhere", "a"]
					["someHere",  "b"]
					["someThere", "c"]
				], (error) ->
					client.list "", (error, list) ->
						throw error if error
						async.each ["some", "someWhere", "someHere", "someThere"], ((el, cb) ->
							assert el in list
							cb()
						), (error) ->
							throw error if error
							done()

			it "new client", (done) ->
				client.on "stopped", ->
					newClient (c) ->
						client = c
						done()
				client.stop()

			it "list", (done) ->
				client.list "", (error, list) ->
					assert.deepEqual list, []
					done()

	describe "services", ->
		before (done) ->
			client.on "stopped", ->
				newClient "hmzjaa", (c) ->
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

		describe "get ports - empty", ->
			it "should get the services ports (empty)", (done) ->
				client.getPorts (error, ports) ->
					throw error if error
					assert.deepEqual ports, []
					done()

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
				client.register "some-serverice", (error, port) ->
					throw error if error
					client.getPorts (error, ports) ->
						return error if error
						assert port in ports
						assert not (port in services.map (s) -> s.port)
						done()

		describe "Query tests", ->

			it "Query with a non exsisting role, should not trigger onData", (done) ->
				@timeout 50000

				client.query "GekkeGerrit", (data) ->
					console.log data
					done()

				client.register "GekkeGerrit", (error, port) ->
					throw error if error

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