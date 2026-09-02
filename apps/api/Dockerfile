# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS builder
ENV DATABASE_URL=postgresql://build:build@localhost:5432/opspilot
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY apps/api ./apps/api
RUN npm run db:generate && npm run build --workspace=@opspilot/api

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --workspace=@opspilot/api --include-workspace-root \
  && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  API_HOST=0.0.0.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/prisma.config.ts ./
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist

USER node

FROM runtime AS worker
HEALTHCHECK NONE
CMD ["node", "apps/api/dist/worker.js"]

FROM runtime AS api
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||process.env.PORT||4100)+'/api/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
