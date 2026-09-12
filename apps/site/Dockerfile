FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/site/package.json apps/site/
RUN pnpm install --frozen-lockfile --filter @ronan/site...

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/site/node_modules ./apps/site/node_modules
COPY tsconfig.base.json ./
COPY apps/site ./apps/site
# Sem ARG/ENV de VITE_* aqui: o site não lê variáveis de ambiente. Os valores
# públicos (número, domínios, lojas) moram em src/lib/config.ts, que é a única
# fonte. As variáveis do painel do Easypanel CHEGAM no ambiente deste build —
# era o que vinha sobrescrevendo o número de WhatsApp e esvaziando o e-mail.
RUN cd apps/site && pnpm build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/site/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fs http://localhost/healthz || exit 1
