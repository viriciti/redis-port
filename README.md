redis-port
==========

Service registry and port assignment using Redis

Prerequisites
-------------
Be sure to run a Redis server with `notify-keyspace-events` enabled.

	sudo docker run -d -p 9090:6379 --name=redis-port redis redis-server --notify-keyspace-events KEA
