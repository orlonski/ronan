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
# Os valores públicos do site (número, domínios, lojas) moram em
# src/lib/config.ts, não aqui: o Easypanel não passa build arg, e as variáveis
# de ambiente dele são de runtime — nginx servindo estático não as enxerga.
# Estes ARGs existem só pra build local/CI que queira apontar pra outro
# ambiente; sem eles, valem os padrões do config.ts.
ARG VITE_SITE_URL
ARG VITE_APP_URL
ARG VITE_PWA_URL
ARG VITE_WHATSAPP
ARG VITE_EMAIL
ARG VITE_PLAY_URL
ARG VITE_APPSTORE_URL
ENV VITE_SITE_URL=$VITE_SITE_URL VITE_APP_URL=$VITE_APP_URL VITE_PWA_URL=$VITE_PWA_URL \
    VITE_WHATSAPP=$VITE_WHATSAPP VITE_EMAIL=$VITE_EMAIL \
    VITE_PLAY_URL=$VITE_PLAY_URL VITE_APPSTORE_URL=$VITE_APPSTORE_URL
RUN cd apps/site && pnpm build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/site/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fs http://localhost/healthz || exit 1
