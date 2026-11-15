# syntax=docker/dockerfile:1
# Imagem isolada do dwg-extractor — GPL-3.0-or-later (usa @mlightcad/libredwg-web, GPL-3.0).
# Build: docker build -t canteirocheck-dwg-extractor services/dwg-extractor

FROM node:22-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile --ignore-workspace
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM base AS deps
RUN pnpm install --frozen-lockfile --ignore-workspace --prod

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8090
WORKDIR /app
COPY package.json LICENSE ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8090) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
