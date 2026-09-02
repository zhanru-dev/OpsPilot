# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
  NEXT_TELEMETRY_DISABLED=1
COPY apps/web ./apps/web
RUN npm run build --workspace=@opspilot/web

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000

COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
