FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY public-launch-readiness-contract-version.txt ./
COPY biome.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY tests ./tests
RUN pnpm check && pnpm build && pnpm prune --prod

FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/public-launch-readiness-contract-version.txt ./

USER node
EXPOSE 8100
CMD ["node", "dist/main.js"]
