FROM oven/bun:1.4.2-debian@sha256:53710ce0f14eef8312521c586a7ae1d9aeab4011840f09f1966073b68fc2e2ab AS bun
FROM oven/bun:1.4.4-debian@sha256:b740c3f5600e6360684f240d31c67ffb759def968bfa98ed98c4cce970707735 AS bun_current
FROM denoland/deno:debian-2.9.7@sha256:869d374bdaddda4fde029c492d7219199b0e821c2c53cca5357b3a6f5b9336fc AS deno
FROM node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS node24
FROM node:26.10.0-bookworm@sha256:b52be70bd101193c6fcbb8bc3ea98458ffcabce39d6f930566b159e199931d5f

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun_current /usr/local/bin/bun /usr/local/bin/bun144
COPY --from=deno /usr/bin/deno /usr/local/bin/deno
COPY --from=node24 /usr/local/bin/node /usr/local/bin/node24
RUN mkdir /workspace /study /results && chown 65534:65534 /workspace /results
COPY --chown=65534:65534 package.json package-lock.json /workspace/
COPY *.cjs *.pem yargs-diagnostic.mjs /pilot/
COPY source-suites/ /pilot/source/
COPY release-assets/ /pilot/assets/

ENV HOME=/tmp DENO_DIR=/tmp/deno NO_COLOR=1
USER 65534:65534
WORKDIR /workspace
ENTRYPOINT ["/bin/sh", "-ec"]
