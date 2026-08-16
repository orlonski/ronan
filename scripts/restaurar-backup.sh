#!/usr/bin/env bash
#
# Restauração do backup do Ronan.
#
# Serve pras duas situações, e a diferença entre elas é a coisa mais importante
# deste arquivo:
#
#   1. TESTE (padrão) — restaura numa base descartável e confere se os dados
#      estão lá. É o que prova que o backup funciona. Backup que nunca foi
#      restaurado não é backup, é esperança: dump truncado, senha trocada e
#      permissão faltando só aparecem na hora de restaurar, e a hora de
#      restaurar de verdade é a pior hora possível pra descobrir.
#
#   2. DESASTRE — restaura por cima de um banco real. Exige confirmação
#      explícita (RESTAURAR_EM_PRODUCAO=sim-eu-tenho-certeza) porque apaga o
#      que estiver lá. Sem essa trava, um tab errado no meio da madrugada de
#      um incidente termina de matar o que sobrou.
#
# Uso:
#   ./restaurar-backup.sh                      # baixa o mais recente e testa
#   ./restaurar-backup.sh banco/2026/08/x.dump # testa um específico
#   ./restaurar-backup.sh --listar             # só lista o que existe no R2
#
# Variáveis: as mesmas do backup.sh, mais
#   RESTORE_DB       nome da base de teste (default: ronan_restore_teste)
#   RESTAURAR_EM_PRODUCAO=sim-eu-tenho-certeza   (só pro caso 2)

set -euo pipefail

log() { echo "[restore] $*"; }
erro() { echo "[restore] ERRO: $*" >&2; exit 1; }

for v in POSTGRES_HOST POSTGRES_USER POSTGRES_PASSWORD \
         BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY; do
  [ -n "${!v:-}" ] || erro "variável $v não configurada"
done

mc alias set destino "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" --api S3v4 >/dev/null

if [ "${1:-}" = "--listar" ]; then
  log "backups do banco disponíveis (mais recentes por último):"
  mc ls --recursive "destino/${BACKUP_S3_BUCKET}/banco/" | sort
  exit 0
fi

# ---------------------------------------------------------------------------
# Escolhe o arquivo
# ---------------------------------------------------------------------------
ALVO="${1:-}"
if [ -z "$ALVO" ]; then
  ALVO=$(mc ls --recursive "destino/${BACKUP_S3_BUCKET}/banco/" | sort | tail -1 | awk '{print $NF}')
  [ -n "$ALVO" ] || erro "nenhum backup encontrado em ${BACKUP_S3_BUCKET}/banco/"
  ALVO="banco/$ALVO"
  log "usando o mais recente: $ALVO"
fi

TMP=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$TMP'" EXIT
LOCAL="$TMP/backup.dump"

log "baixando $ALVO"
mc cp "destino/${BACKUP_S3_BUCKET}/${ALVO}" "$LOCAL"

log "conferindo o arquivo"
pg_restore --list "$LOCAL" > "$TMP/indice.txt" || erro "dump ilegível — este backup NÃO presta"
TABELAS=$(grep -c "TABLE DATA" "$TMP/indice.txt" || true)
log "arquivo íntegro: $TABELAS tabelas com dados"

# ---------------------------------------------------------------------------
# Decide onde restaurar
# ---------------------------------------------------------------------------
if [ "${RESTAURAR_EM_PRODUCAO:-}" = "sim-eu-tenho-certeza" ]; then
  ALVO_DB="${POSTGRES_DB:?POSTGRES_DB não definido}"
  log "!!! RESTAURANDO POR CIMA DE '$ALVO_DB' — o conteúdo atual será substituído"
  log "!!! 10 segundos pra cancelar com Ctrl-C"
  sleep 10
else
  ALVO_DB="${RESTORE_DB:-ronan_restore_teste}"
  log "modo TESTE — restaurando na base descartável '$ALVO_DB'"
  log "(pra restaurar de verdade: RESTAURAR_EM_PRODUCAO=sim-eu-tenho-certeza)"
  PGPASSWORD="$POSTGRES_PASSWORD" dropdb -h "$POSTGRES_HOST" -U "$POSTGRES_USER" --if-exists "$ALVO_DB"
  PGPASSWORD="$POSTGRES_PASSWORD" createdb -h "$POSTGRES_HOST" -U "$POSTGRES_USER" "$ALVO_DB"
fi

# ---------------------------------------------------------------------------
# Restaura
# ---------------------------------------------------------------------------
# --clean --if-exists: derruba o que existir antes de recriar, pra restauração
# em base já povoada não falhar em cada objeto duplicado.
# Sem --exit-on-error de propósito: avisos de extensão/owner são normais num
# dump --no-owner e não devem abortar uma restauração de emergência.
log "restaurando em '$ALVO_DB' (pode demorar)"
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
  -h "$POSTGRES_HOST" \
  -U "$POSTGRES_USER" \
  -d "$ALVO_DB" \
  --clean --if-exists \
  --no-owner --no-acl \
  --jobs=4 \
  "$LOCAL" 2> "$TMP/restore-erros.txt" || log "pg_restore terminou com avisos (normal)"

# ---------------------------------------------------------------------------
# Prova que os dados estão lá
# ---------------------------------------------------------------------------
# Sem esta conferência, "restaurou sem erro" continua não querendo dizer nada:
# um banco com todas as tabelas criadas e zero linha passaria batido.
log "conferindo o que entrou:"
PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$ALVO_DB" -t <<'SQL'
SELECT format('  %-24s %s registros',
              rel, to_char(n, 'FM999G999G999'))
FROM (
  SELECT 'viagens' AS rel, count(*) AS n FROM viagens
  UNION ALL SELECT 'motoristas', count(*) FROM motoristas
  UNION ALL SELECT 'fotos de ticket', count(*) FROM ticket_fotos
  UNION ALL SELECT 'pedagios', count(*) FROM pedagios
  UNION ALL SELECT 'abastecimentos', count(*) FROM abastecimentos
  UNION ALL SELECT 'fechamentos', count(*) FROM fechamentos
  UNION ALL SELECT 'contas', count(*) FROM contas
) x ORDER BY rel;
SQL

# Aspas SIMPLES no SQL seriam engolidas pelo -c entre aspas simples do shell, e
# aspas duplas o Postgres leria como nome de coluna — por isso o literal fica
# fora da query e o "vazio" é tratado aqui.
ULTIMA=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$ALVO_DB" -t -A \
  -c 'SELECT max("sincronizadoEm")::text FROM viagens' 2>/dev/null || true)
log "viagem mais recente no backup: ${ULTIMA:-nenhuma viagem no dump (!)}"
log ""
log "Confira os números acima contra o que você espera do sistema hoje."
log "Se bater, o backup presta. Se vier zerado ou muito velho, ele NÃO presta"
log "e isso precisa ser resolvido hoje, não no dia do desastre."
