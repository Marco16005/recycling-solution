# syntax=docker/dockerfile:1.7
# checkov:skip=CKV_DOCKER_2: la salud de la aplicación la revisa Compose (healthcheck de web en compose.prod.yaml y compose.test.yaml).
# Etapas: deps (dependencias exactas del lockfile), dev (herramientas y pruebas), build (next build), runner (producción)
# y e2e (Playwright con navegadores, para las pruebas de punta a punta).

FROM node:24.22.2-trixie-slim AS deps
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS dev
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY . .
# Desarrollo y pruebas corren como root para escribir en los volúmenes de node_modules y .next; producción (runner) usa node.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["npm", "run", "dev"]

FROM dev AS build
ENV NODE_ENV=production
RUN npm run build

# Plan de seguridad (S2 y S3): Node 24.22.2 corrige CVE-2026-111497, explotada activamente; Debian 13 trae menos
# fallas sin corrección que Debian 12. Producción solo necesita `node`: se quitan npm, npx y corepack, que no se usan
# y traen sus propias dependencias vulnerables.
FROM node:24.22.2-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM mcr.microsoft.com/playwright:v1.64.0-noble AS e2e
ENV NPM_CONFIG_UPDATE_NOTIFIER=false CI=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
CMD ["npx", "playwright", "test"]
