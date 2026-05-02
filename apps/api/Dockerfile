FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# ---- deps com tudo (pra build) ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api
# shared-types precisa ser buildado antes da api (api importa de @ronan/shared-types/dist)
RUN cd packages/shared-types && pnpm build
RUN cd apps/api && pnpm prisma generate && pnpm build

# ---- runtime mínimo ----
FROM node:20-alpine AS runtime
RUN apk add --no-cache curl tini openssl && \
    corepack enable && corepack prepare pnpm@9.12.3 --activate && \
    addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production

# copia tudo necessário do build (inclui Prisma engines e node_modules completo)
COPY --from=build /repo/apps/api/dist             ./dist
COPY --from=build /repo/apps/api/prisma           ./prisma
COPY --from=build /repo/apps/api/package.json     ./
COPY --from=build /repo/apps/api/node_modules     ./node_modules
COPY --from=build /repo/packages/shared-types     ../packages/shared-types

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
