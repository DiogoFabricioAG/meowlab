# Portal app.meowlab.tech para el VPS (ADR-0006). Construir desde apps/meowlab-app:
#   docker build -t meowlab-app:<commit> .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:node

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DIST_DIR=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/build/server.mjs ./server.mjs
COPY migrations-postgres ./migrations-postgres
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
