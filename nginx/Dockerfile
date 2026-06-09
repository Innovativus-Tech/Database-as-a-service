FROM nginx:1.27-alpine

# Replace the default config — we use the *stream* module, not http, for TCP DB routing.
COPY nginx.conf /etc/nginx/nginx.conf

# Stream blocks live in this dir and are included from nginx.conf.
RUN mkdir -p /etc/nginx/stream.d

EXPOSE 27018-27999 5433-5999
CMD ["nginx", "-g", "daemon off;"]
