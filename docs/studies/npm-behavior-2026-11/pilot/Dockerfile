FROM oven/bun:1.4.2-debian@sha256:53710ce0f14eef8312521c586a7ae1d9aeab4011840f09f1966073b68fc2e2ab AS bun
FROM denoland/deno:debian-2.9.7@sha256:869d374bdaddda4fde029c492d7219199b0e821c2c53cca5357b3a6f5b9336fc AS deno
FROM node:26.10.0-bookworm-slim@sha256:0a992e1420e2d70611578f1844a6f10a9d11fe6bb535aabf72efe3007f13d79b

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=deno /usr/bin/deno /usr/local/bin/deno
RUN mkdir /workspace /study && chown 65534:65534 /workspace
COPY --chown=65534:65534 package.json package-lock.json /workspace/
COPY bcrypt.cjs esbuild.cjs upstream-cli.cjs yargs-diagnostic.mjs /pilot/

ENV HOME=/tmp DENO_DIR=/tmp/deno NO_COLOR=1
USER 65534:65534
WORKDIR /workspace
ENTRYPOINT ["/bin/sh", "-ec"]
