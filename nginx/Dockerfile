FROM nginx:1.27-alpine

# inotify-tools powers the stream.d self-reload watcher (see reload-watcher.sh).
RUN apk add --no-cache openssl inotify-tools

# Replace the default config — we use the *stream* module, not http, for TCP DB routing.
COPY nginx.conf /etc/nginx/nginx.conf

# Self-reload on stream config changes — replaces the backend's
# `docker exec <name> nginx -s reload`, which breaks when the orchestrator
# (Coolify) generates its own container names.
COPY reload-watcher.sh /reload-watcher.sh
RUN chmod +x /reload-watcher.sh

# Self-signed cert used to encrypt user-DB traffic. 10-year expiry because
# this is transport encryption only — clients connect with
# tls=true&tlsAllowInvalidCertificates=true (Mongo) or sslmode=require (PG),
# i.e. encrypted-in-transit without identity verification. Replace with a
# real CA-issued cert if you want strict verification.
RUN mkdir -p /etc/nginx/tls && \
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout /etc/nginx/tls/customdb.key \
      -out    /etc/nginx/tls/customdb.crt \
      -days   3650 \
      -subj   "/CN=customdb-self-signed"

# Stream blocks live in this dir and are included from nginx.conf. Gateway map
# entries live in a child dir so the top-level include only sees server blocks.
RUN mkdir -p /etc/nginx/stream.d/mongo-gateway

EXPOSE 27017 27018-27999 5433-5999
# Watcher runs in the background; exec keeps nginx as the main process so it
# still receives container stop signals directly.
CMD ["/bin/sh", "-c", "/reload-watcher.sh & exec nginx -g 'daemon off;'"]
