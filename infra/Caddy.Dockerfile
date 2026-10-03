FROM node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS binary
ARG TARGETARCH
COPY infra/fetch-caddy.mjs /tmp/fetch-caddy.mjs
RUN node /tmp/fetch-caddy.mjs && tar -xzf /tmp/caddy.tar.gz -C /tmp caddy
FROM caddy:2.11.6-alpine@sha256:c776e0c6413b544d0459665e54ec7b8b2a15000c0cbee8b254da0067b1d184ff
COPY --from=binary /tmp/caddy /usr/bin/caddy
RUN caddy version
