FROM node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7
WORKDIR /fixture
COPY --chown=65534:65534 . .
USER 65534:65534
ENTRYPOINT ["node", "/fixture/run.mjs"]
