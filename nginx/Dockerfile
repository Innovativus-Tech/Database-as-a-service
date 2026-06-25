FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

# Replace the default config — we use the *stream* module, not http, for TCP DB routing.
COPY nginx.conf /etc/nginx/nginx.conf

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

# Stream blocks live in this dir and are included from nginx.conf.
RUN mkdir -p /etc/nginx/stream.d

EXPOSE 27018-27999 5433-5999
CMD ["nginx", "-g", "daemon off;"]
