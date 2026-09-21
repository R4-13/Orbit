# Project ORBIT — Web (Next.js) production image
# See apps/api/Dockerfile for why `turbo prune` is used instead of manually
# COPYing a package.json subset.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @orbit/web --docker

FROM base AS deps
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY --from=pruner /repo/out/full/ .
# See apps/api/Dockerfile: tsconfig `extends` isn't part of the
# package-manifest graph `turbo prune` follows.
COPY tsconfig.base.json ./
# apps/web imports @orbit/domain's Prisma-derived types (API response
# shapes) — its own build needs the generated Prisma Client to exist first,
# same as apps/api's build (see apps/api/Dockerfile).
RUN pnpm --filter @orbit/domain prisma:generate
RUN pnpm --filter @orbit/web... build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
