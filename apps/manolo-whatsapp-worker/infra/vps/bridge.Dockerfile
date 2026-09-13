FROM node:22-alpine@sha256:76789712cd1ae89a1225eac9077010d68987a423588042dac30446f502f1858c AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json worker-configuration.d.ts ./
COPY src ./src
RUN npm run build:node
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine@sha256:76789712cd1ae89a1225eac9077010d68987a423588042dac30446f502f1858c AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/node/server.mjs"]
