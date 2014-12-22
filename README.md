redis-port
==========

Service registry and port assignment using Redis

Prerequisites
-------------
Be sure to run a Redis server with `notify-keyspace-events` enabled.

Add this line to your `redis.conf`
  notify-keyspace-events KEA
or run a docker process
  sudo docker run -d --name=redis-port redis redis-server --notify-keyspace-events KEA
