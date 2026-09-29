#!/usr/bin/env bash
# Stack LOCAL e DESCARTÁVEL pra medir o painel (tests/ux). Nunca toca em produção nem em processo alheio.
#
#   tests/ux/subir-stack.sh subir      Postgres novo (docker) + migrate + seed + API + painel
#   tests/ux/subir-stack.sh derrubar   mata SÓ o que este script subiu (por PID) e DROPA o banco
#   tests/ux/subir-stack.sh status     mostra o que está de pé
#   tests/ux/subir-stack.sh tudo [args do playwright]   sobe, roda `pnpm ux`, derruba (mesmo se falhar)
#
# Portas (fora das usuais de propósito; sobrescreva por env se colidirem):
#   UX_API_PORT=3100  UX_DASH_PORT=3101  UX_PG_PORT=5464
# Se uma porta já estiver ocupada por processo que NÃO é nosso, o script aborta — não derruba ninguém.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
ESTADO="$AQUI/.stack"
API_PORT="${UX_API_PORT:-3100}"
DASH_PORT="${UX_DASH_PORT:-3101}"
PG_PORT="${UX_PG_PORT:-5464}"
PG_NOME="ronan-ux-pg"
DB="uxmedidas"
DB_URL="postgresql://ux:ux@localhost:${PG_PORT}/${DB}"
NEXTAUTH_SECRET_UX="ux-medidas-nextauth-secret"

mkdir -p "$ESTADO"

porta_ocupada() { lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1; }
pid_vivo() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

matar_nosso() { # $1=arquivo de pid, $2=trecho esperado na linha de comando (garante que é nosso)
  [ -f "$1" ] || return 0
  local pid; pid="$(cat "$1")"
  if kill -0 "$pid" 2>/dev/null; then
    # o comando é só "node dist/main.js"; o que prova que é nosso é o diretório de trabalho do processo
    if lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -q "$2"; then
      # o pid guardado é o do processo-líder do grupo; mata o grupo pra levar os filhos do next junto
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    else
      echo "  pid $pid não é mais nosso (comando mudou); não mato." >&2
    fi
  fi
  rm -f "$1"
}

psql_pg() { docker exec "$PG_NOME" psql -U ux -v ON_ERROR_STOP=1 "$@"; }

subir_pg() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$PG_NOME"; then
    docker start "$PG_NOME" >/dev/null
  else
    porta_ocupada "$PG_PORT" && { echo "porta $PG_PORT ocupada por outro processo; use UX_PG_PORT=<outra>." >&2; exit 1; }
    docker run -d --name "$PG_NOME" -e POSTGRES_USER=ux -e POSTGRES_PASSWORD=ux -e POSTGRES_DB=postgres \
      -p "${PG_PORT}:5432" postgres:17-alpine >/dev/null
  fi
  for _ in $(seq 1 40); do docker exec "$PG_NOME" pg_isready -U ux >/dev/null 2>&1 && return 0; sleep 1; done
  echo "Postgres não subiu." >&2; exit 1
}

recriar_banco() {
  psql_pg -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}" >/dev/null
  psql_pg -d "$DB" -c "create extension if not exists pg_trgm" -c "create extension if not exists unaccent" >/dev/null
  (cd "$RAIZ/apps/api" && DATABASE_URL="$DB_URL" pnpm exec prisma migrate deploy 2>&1 | tail -2)
  DATABASE_URL="$DB_URL" node "$AQUI/stack/seed.cjs" 2>&1 | tail -15
  DATABASE_URL="$DB_URL" node "$AQUI/stack/seed2.cjs" 2>&1 | tail -5
}

montar_api() {
  [ -f "$RAIZ/packages/shared-types/dist/index.js" ] || { echo "rode: pnpm --filter @ronan/shared-types build" >&2; exit 1; }
  # compila a API pra fora de apps/api/dist (não pisa no build de ninguém)
  mkdir -p "$ESTADO/api"
  ln -sfn "$RAIZ/apps/api/node_modules" "$ESTADO/api/node_modules"
  (cd "$RAIZ/apps/api" && pnpm exec tsc -p tsconfig.build.json --outDir "$ESTADO/api" --incremental false)
}

montar_painel() {
  # cópia de trabalho do painel: o `next build` daqui não mexe no .next do seu `pnpm dev`.
  local d="$ESTADO/repo/apps/dashboard"
  mkdir -p "$d"
  ln -sfn "$RAIZ/node_modules" "$ESTADO/repo/node_modules"
  ln -sfn "$RAIZ/packages" "$ESTADO/repo/packages"
  ln -sfn "$RAIZ/apps/dashboard/node_modules" "$d/node_modules"
  cp "$RAIZ/tsconfig.base.json" "$ESTADO/repo/"
  local mudou=""
  mudou+="$(rsync -a --delete --itemize-changes "$RAIZ/apps/dashboard/src/" "$d/src/")"
  mudou+="$(rsync -a --delete --itemize-changes "$RAIZ/apps/dashboard/public/" "$d/public/")"
  for f in package.json tsconfig.json next.config.mjs postcss.config.mjs tailwind.config.ts; do
    cmp -s "$RAIZ/apps/dashboard/$f" "$d/$f" 2>/dev/null || { mudou+="$f"; cp "$RAIZ/apps/dashboard/$f" "$d/$f"; }
  done
  if [ -n "$mudou" ] || [ ! -f "$d/.next/BUILD_ID" ] || [ "${UX_REBUILD:-0}" = "1" ]; then
    echo "  build do painel (next build)..."
    (cd "$d" && NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}" API_URL="http://localhost:${API_PORT}" \
      NEXTAUTH_URL="http://localhost:${DASH_PORT}" NEXTAUTH_SECRET="$NEXTAUTH_SECRET_UX" NEXT_TELEMETRY_DISABLED=1 \
      ./node_modules/.bin/next build) > "$ESTADO/build.log" 2>&1 || { tail -30 "$ESTADO/build.log"; echo "build falhou" >&2; exit 1; }
  else
    echo "  painel sem mudanças desde o último build; reaproveitando (UX_REBUILD=1 força)."
  fi
}

esperar_http() { # $1=url $2=rótulo
  for _ in $(seq 1 90); do curl -fs -o /dev/null "$1" && return 0; sleep 1; done
  echo "$2 não respondeu em $1" >&2; exit 1
}

subir() {
  command -v docker >/dev/null || { echo "docker é necessário" >&2; exit 1; }
  for p in "$API_PORT" "$DASH_PORT"; do
    if porta_ocupada "$p" && ! { [ "$p" = "$API_PORT" ] && pid_vivo "$ESTADO/api.pid"; } && ! { [ "$p" = "$DASH_PORT" ] && pid_vivo "$ESTADO/dash.pid"; }; then
      echo "porta $p está ocupada por um processo que não é deste stack. Não vou derrubar. Use UX_API_PORT / UX_DASH_PORT." >&2
      exit 1
    fi
  done
  matar_nosso "$ESTADO/api.pid" "$ESTADO/api"
  matar_nosso "$ESTADO/dash.pid" "$ESTADO/repo/apps/dashboard"
  echo "[1/5] Postgres temporário ($PG_NOME em :$PG_PORT)"; subir_pg
  echo "[2/5] Banco + migrations + seed"; recriar_banco
  echo "[3/5] Compilando a API"; montar_api
  echo "[4/5] Construindo o painel"; montar_painel

  local t0; t0="$(node -e 'console.log(Date.now())')"
  echo "$t0" > "$ESTADO/real_t0"
  local fixar="--require $AQUI/stack/fixar-data.cjs"
  echo "[5/5] Subindo API :$API_PORT e painel :$DASH_PORT"
  # `set -m` põe cada um em seu próprio grupo de processos: dá pra derrubar o next inteiro por PID.
  set -m
  (
    cd "$ESTADO/api"
    export NODE_ENV=development PORT="$API_PORT" DATABASE_URL="$DB_URL" UX_REAL_T0="$t0" NODE_OPTIONS="$fixar"
    export JWT_SECRET=ux-medidas-jwt-secret-ux-medidas-jwt-secret JWT_REFRESH_SECRET=ux-medidas-refresh-secret-ux-medidas-refresh
    export JWT_EXPIRES_IN=8h JWT_REFRESH_EXPIRES_IN=7d
    export CORS_ORIGINS="http://localhost:${DASH_PORT}" PUBLIC_APP_URL="http://localhost:${DASH_PORT}"
    # nada externo: MinIO aponta pra porta morta e todas as chaves de serviço ficam vazias (degradam)
    export MINIO_ENDPOINT=127.0.0.1 MINIO_PORT=9 MINIO_USE_SSL=false MINIO_ACCESS_KEY=x MINIO_SECRET_KEY=xxxxxxxx MINIO_BUCKET=ux-medidas-nao-existe
    export MINIMAX_API_KEY= GEMINI_API_KEY= GOOGLE_MAPS_KEY= ANTHROPIC_API_KEY= OPENAI_API_KEY= MARKETING_INGEST_TOKEN= OSRM_URL= VALHALLA_URL= EVOLUTION_API_URL= EVOLUTION_API_KEY=
    exec node dist/main.js > "$ESTADO/api.log" 2>&1
  ) & echo $! > "$ESTADO/api.pid"
  (
    cd "$ESTADO/repo/apps/dashboard"
    export NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}" API_URL="http://localhost:${API_PORT}"
    export NEXTAUTH_URL="http://localhost:${DASH_PORT}" NEXTAUTH_SECRET="$NEXTAUTH_SECRET_UX" NEXT_TELEMETRY_DISABLED=1
    export UX_REAL_T0="$t0" NODE_OPTIONS="$fixar"
    exec ./node_modules/.bin/next start -p "$DASH_PORT" > "$ESTADO/dash.log" 2>&1
  ) & echo $! > "$ESTADO/dash.pid"
  set +m
  esperar_http "http://localhost:${API_PORT}/health" "API"
  esperar_http "http://localhost:${DASH_PORT}/login" "painel"
  echo "pronto: painel http://localhost:${DASH_PORT}  api http://localhost:${API_PORT}  (login admin@modelo.test / uxmedidas123)"
}

derrubar() {
  matar_nosso "$ESTADO/dash.pid" "$ESTADO/repo/apps/dashboard"
  matar_nosso "$ESTADO/api.pid" "$ESTADO/api"
  if docker ps -a --format '{{.Names}}' | grep -qx "$PG_NOME"; then
    docker ps --format '{{.Names}}' | grep -qx "$PG_NOME" && \
      psql_pg -d postgres -c "drop database if exists ${DB} with (force)" >/dev/null 2>&1 || true
    docker rm -f "$PG_NOME" >/dev/null
  fi
  echo "stack derrubado (processos por PID, banco dropado, container removido)."
}

status() {
  pid_vivo "$ESTADO/api.pid" && echo "api  : de pé (pid $(cat "$ESTADO/api.pid")) :$API_PORT" || echo "api  : parada"
  pid_vivo "$ESTADO/dash.pid" && echo "painel: de pé (pid $(cat "$ESTADO/dash.pid")) :$DASH_PORT" || echo "painel: parado"
  docker ps --format '{{.Names}}' | grep -qx "$PG_NOME" && echo "postgres: de pé (:$PG_PORT)" || echo "postgres: parado"
}

case "${1:-}" in
  subir) subir ;;
  derrubar) derrubar ;;
  status) status ;;
  tudo)
    shift
    trap derrubar EXIT
    subir
    cd "$RAIZ"
    UX_API="http://localhost:${API_PORT}" UX_DASH="http://localhost:${DASH_PORT}" UX_NEXTAUTH_SECRET="$NEXTAUTH_SECRET_UX" pnpm ux "$@"
    ;;
  *) sed -n 2,14p "$0"; exit 2 ;;
esac
