FROM node:24-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY biome.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY tests ./tests
RUN pnpm check && pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 8100
CMD ["node", "dist/main.js"]
