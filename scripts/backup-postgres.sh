#!/usr/bin/env bash
#
# Backup diário do Postgres do Ronan pra Cloudflare R2 (S3-compatible).
#
# Configurar como Cron Job no Easypanel rodando à 3h da manhã:
#   0 3 * * * /scripts/backup-postgres.sh
#
# Variáveis de ambiente necessárias:
#   POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY
#   BACKUP_RETAIN_DAYS (default: 30)

set -euo pipefail

: "${POSTGRES_HOST:?POSTGRES_HOST não definido}"
: "${POSTGRES_USER:?POSTGRES_USER não definido}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD não definido}"
: "${POSTGRES_DB:?POSTGRES_DB não definido}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT não definido}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET não definido}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY não definido}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY não definido}"

RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

DATA=$(date -u +%Y%m%d-%H%M%S)
ARQ="ronan-${DATA}.dump.gz"
TMP="/tmp/${ARQ}"

echo "[backup] gerando $ARQ"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --format=custom \
  --no-owner \
  --no-acl \
  | gzip -9 > "$TMP"

TAMANHO=$(du -h "$TMP" | cut -f1)
echo "[backup] dump gerado: $TAMANHO"

# Upload via mc (MinIO Client é S3-compatible com R2)
mc alias set r2 "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" --api S3v4 >/dev/null

mc cp "$TMP" "r2/${BACKUP_S3_BUCKET}/${ARQ}"
echo "[backup] enviado pra r2/${BACKUP_S3_BUCKET}/${ARQ}"

rm -f "$TMP"

# limpa backups antigos (> RETAIN_DAYS)
LIMITE=$(date -u -d "$RETAIN_DAYS days ago" +%Y%m%d 2>/dev/null || date -u -v-"${RETAIN_DAYS}"d +%Y%m%d)
echo "[backup] removendo backups anteriores a $LIMITE"
mc ls "r2/${BACKUP_S3_BUCKET}/" | awk '{print $NF}' | while read -r OBJ; do
  if [[ "$OBJ" =~ ronan-([0-9]{8}) ]]; then
    DATE_OBJ="${BASH_REMATCH[1]}"
    if [[ "$DATE_OBJ" < "$LIMITE" ]]; then
      mc rm "r2/${BACKUP_S3_BUCKET}/${OBJ}"
      echo "[backup] removido $OBJ"
    fi
  fi
done

echo "[backup] concluído"
