# syntax=docker/dockerfile:1.7
# Etapas: deps (dependencias exactas del lockfile), dev (herramientas y pruebas), build (next build), runner (producción)
# y e2e (Playwright con navegadores, para las pruebas de punta a punta).

FROM node:24.21.0-bookworm-slim AS deps
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS dev
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY . .
CMD ["npm", "run", "dev"]

FROM dev AS build
ENV NODE_ENV=production
RUN npm run build

FROM node:24.21.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
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
