# Project ORBIT — API & Worker production image
# Multi-stage build: install workspace deps once, build only what's needed.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/integration-core/package.json packages/integration-core/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --no-frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm --filter @orbit/domain prisma:generate
RUN pnpm --filter @orbit/domain... --filter @orbit/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY --from=build /repo /repo
EXPOSE 3001
CMD ["node", "apps/api/dist/api/main.js"]
