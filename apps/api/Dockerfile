# Project ORBIT — API & Worker production image
# Multi-stage build using `turbo prune` (the officially recommended pattern
# for pnpm + Turborepo Docker builds): prune computes exactly the workspace
# subset @orbit/api needs, plus a matching, self-contained pnpm-lock.yaml —
# avoiding the classic "partial package.json COPY list drifts out of sync
# with pnpm-lock.yaml" failure mode (see docs/ASSUMPTIONS.md #41).

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @orbit/api --docker

FROM base AS deps
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY --from=pruner /repo/out/full/ .
# `turbo prune` only follows the package-manifest dependency graph, so a
# root file referenced solely via tsconfig `extends` isn't included — copy
# it explicitly.
COPY tsconfig.base.json ./
RUN pnpm --filter @orbit/domain prisma:generate
# `--filter @orbit/api...` (not just `--filter @orbit/api`) is required: the
# trailing `...` pulls in every workspace package @orbit/api depends on
# (domain, config, agent-core, integration-core, shared), building them in
# topological order. Without it, only @orbit/api's own script runs — its
# dependencies silently don't get built (previously missed: @orbit/config).
RUN pnpm --filter @orbit/api... build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
# nest-cli.json declares outDir "dist/api", but apps/api/tsconfig.json's own
# (authoritative for the default tsc builder) outDir "./dist" wins, and with
# no explicit rootDir the output mirrors "src/main.ts" as "dist/src/main.js"
# — verified against the actual built image, not nest-cli.json's setting.
EXPOSE 3001
CMD ["node", "apps/api/dist/src/main.js"]
