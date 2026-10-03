FROM node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --ignore-scripts pnpm@12.8.1
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm web:build
RUN cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

FROM node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM node:24.21.0-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS control
RUN apt-get update && apt-get install --yes --no-install-recommends iproute2=6.1.0-3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/services ./services
COPY --from=build --chown=node:node /app/apps/cli ./apps/cli
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
CMD ["node", "services/control/dist/bin.js"]
