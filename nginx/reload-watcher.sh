#!/bin/sh
# Watches the per-database stream config dir and hot-reloads nginx whenever
# the backend adds/removes a block.
#
# Why this exists: the backend's own reload path is `docker exec
# $NGINX_CONTAINER nginx -s reload`, which requires knowing this container's
# name. Coolify (and most orchestrators) override container_name with
# generated names, so that exec silently fails in production — and a newly
# created database's route never went live until the container restarted.
# Watching the shared bind mount from the inside needs no name, no docker
# socket, and works identically under plain compose and Coolify.
STREAM_DIR=/etc/nginx/stream.d

while inotifywait -q -r -e create -e modify -e delete -e move "$STREAM_DIR" >/dev/null 2>&1; do
  # Debounce: the backend writes the .conf then triggers its own (possibly
  # failing) reload; batch rapid successive changes into one reload.
  sleep 1
  # Never reload into a broken config — a half-written file would take down
  # routing for every database. -t validates first; on failure we just wait
  # for the next event (the backend finishing its write triggers one).
  if nginx -t -q 2>/dev/null; then
    nginx -s reload 2>/dev/null || true
  fi
done
