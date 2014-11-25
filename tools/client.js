var RedisPort = require("../build/RedisPort");

var name    = process.argv[2] || "undefined";
var host    = process.argv[3] || "localhost";
var project = process.argv[4] || "project";
var env     = process.argv[5] || "development";

var client = new RedisPort({
	  redisHost: "localhost"
	, redisPort: 9090
	, host:      host
	, project:   project
	, env:       env
});

var send = function (type, data) {
	if (process.send) {
		process.send({
			type: type,
			data: data
		});
	}
}

var say = function (str) {
	var args = [].slice.call(arguments, 0);

	args[0] = "Client "+ name +": "+ args[0]

	console.log.apply(null, args);
}

say("Starting.");

client.on("started", function() {
	say("Started", host, project, env);
	send("started");

	process.on("message", function(msg) {

		if (msg.type && msg.type === "query") {
			var role = msg.data;

			if (!role) {
				say("No role in message for query command");
				return;
			}

			client.query(role, function(data) {
				if (data && data.port) {
					say("New info on "+ role +". Got: ", data.port);
					send("port", data.port);
				} else {
					say("GOT WRONG DATA!\n", data, "\n");
				}
			});
			say("Queried for "+ role);
			send("queried");
		} else if (msg.type && msg.type === "register") {
			var role = msg.data;

			if (!role) {
				say("No role in message for register command");
				return;
			}

			client.register(role, function(error, port) {
				say("Registered to "+ host +":"+ port);
				send("registered", port);
			});
		}
	});
});

client.start();