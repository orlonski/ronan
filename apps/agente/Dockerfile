# Imagem do serviço `ronan_agente`: consome a fila de execuções e (na fase 2)
# roda o Claude Code headless num worktree isolado.
#
# Compartilha o código da API — mesmo build, mesmo Prisma Client — mas é um
# container à parte: quem recebe webhook e quem executa não podem ser o mesmo
# processo.
#
# Debian (não Alpine) de propósito: o CLI do Claude Code traz binários nativos
# (ripgrep) linkados a glibc, e git de verdade é requisito do worktree.
FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# ---- deps ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential openssl \
    && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api
RUN cd packages/shared-types && pnpm build
RUN cd apps/api && pnpm prisma generate && pnpm build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
# Chromium entra por causa do marketing: a arte dos posts do Instagram é HTML
# renderizado em imagem (marketing/instagram/render.mjs), e a API da Meta não
# aceita upload de arquivo — ela busca um JPEG numa URL. Sem browser aqui, o
# agente escreve a legenda e não tem como produzir a peça.
#
# É o pacote da distro, não o que o Playwright baixa: a imagem já é Debian, o
# binário vem assinado pelo repositório e não engorda o build com um download a
# cada deploy. O render aponta pra ele por PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates openssl tini \
      chromium fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code \
    && useradd -m -u 10001 agente
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
# O Playwright não precisa baixar browser: já tem um instalado acima.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

WORKDIR /repo
COPY --from=build /repo/node_modules              ./node_modules
COPY --from=build /repo/packages/shared-types     ./packages/shared-types
COPY --from=build /repo/apps/api/dist             ./apps/api/dist
COPY --from=build /repo/apps/api/package.json     ./apps/api/
COPY --from=build /repo/apps/api/node_modules     ./apps/api/node_modules
COPY apps/agente/entrypoint.sh                    /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Onde os worktrees por task vão morar (fase 2). Volume no Easypanel.
RUN mkdir -p /trabalho && chown agente:agente /trabalho
ENV AGENTE_DIR_TRABALHO=/trabalho

WORKDIR /repo/apps/api
USER agente

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/agente-main.js"]
