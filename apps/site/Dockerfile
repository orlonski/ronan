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
# URLs públicas entram no build (vão bakeadas no HTML/JS)
ARG VITE_SITE_URL=https://www.movatruck.com.br
ARG VITE_APP_URL=https://app.movatruck.com.br
ARG VITE_WHATSAPP=5541999999999
ENV VITE_SITE_URL=$VITE_SITE_URL VITE_APP_URL=$VITE_APP_URL VITE_WHATSAPP=$VITE_WHATSAPP
RUN cd apps/site && pnpm build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/site/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fs http://localhost/healthz || exit 1
