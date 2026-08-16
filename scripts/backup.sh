#!/usr/bin/env bash
#
# Backup diário do Ronan: banco (Postgres) + fotos (MinIO) pra fora do Contabo.
#
# Roda como Cron Job no Easypanel, 3h da manhã (ver docs/backup.md).
#
# ────────────────────────────────────────────────────────────────────────────
# A REGRA QUE GOVERNA ESTE ARQUIVO: ele NUNCA apaga nada no destino.
#
# Backup só protege contra invasão se quem tomou o servidor não conseguir
# destruir as cópias. Como as credenciais do destino moram AQUI, dentro do
# servidor, qualquer poder de apagar que este script tenha é poder que o
# invasor herda — e apagar o backup antes de sequestrar o original é o passo 1
# do manual de ransomware.
#
# Por isso a limpeza dos arquivos antigos NÃO é feita aqui: é regra de ciclo de
# vida configurada no próprio R2, do lado de lá, onde nem este script nem quem
# entrar no servidor alcança. A versão anterior deste script fazia `mc rm` — era
# a faca entregue junto com a carteira.
#
# Consequência aceita de propósito: se a regra de ciclo de vida não for
# configurada, o bucket cresce pra sempre. Guardar demais custa alguns reais por
# mês; apagar de menos custa a empresa.
# ────────────────────────────────────────────────────────────────────────────
#
# Variáveis obrigatórias:
#   POSTGRES_HOST POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
#   BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
#
# Opcionais:
#   MINIO_ENDPOINT MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_BUCKET
#       Sem eles o backup roda só do banco e AVISA que as fotos ficaram de fora.
#   BACKUP_PING_URL
#       Monitor de "parou de rodar" (healthchecks.io e afins). Ver docs/backup.md —
#       é o único mecanismo que percebe o backup que morreu em silêncio.
#   BACKUP_ALERTA_URL / BACKUP_ALERTA_TOKEN
#       Webhook avisado quando o backup falha.

set -euo pipefail

log() { echo "[backup] $(date -u +%H:%M:%S) $*"; }

# ---------------------------------------------------------------------------
# Alerta e ping. Os dois são best-effort: problema em avisar nunca pode ser o
# motivo de um backup bom não acontecer.
# ---------------------------------------------------------------------------

ping_monitor() {
  # $1 = "" (sucesso) | "/start" | "/fail"
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  curl -fsS -m 15 --retry 3 "${BACKUP_PING_URL}${1}" -o /dev/null 2>/dev/null || true
}

avisar_falha() {
  local motivo="$1"
  log "FALHOU: $motivo"
  ping_monitor "/fail"
  if [ -n "${BACKUP_ALERTA_URL:-}" ]; then
    curl -fsS -m 20 -X POST "$BACKUP_ALERTA_URL" \
      -H "content-type: application/json" \
      ${BACKUP_ALERTA_TOKEN:+-H "x-backup-token: $BACKUP_ALERTA_TOKEN"} \
      -d "$(printf '{"evento":"backup-falhou","motivo":%s,"em":"%s"}' \
             "$(printf '%s' "$motivo" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')" \
             "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
      -o /dev/null 2>/dev/null || true
  fi
}

# Qualquer erro não tratado daqui pra frente vira alerta, não silêncio.
trap 'avisar_falha "erro na linha $LINENO (veja os logs do cron)"' ERR

exigir() {
  local nome="$1"
  if [ -z "${!nome:-}" ]; then
    avisar_falha "variável $nome não configurada"
    exit 1
  fi
}

for v in POSTGRES_HOST POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
         BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY; do
  exigir "$v"
done

DATA=$(date -u +%Y%m%d-%H%M%S)
DIA=$(date -u +%Y/%m)          # prefixo por mês: facilita achar e dar zoom no R2
TMP=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$TMP'" EXIT

ping_monitor "/start"
log "início ($DATA)"

# ---------------------------------------------------------------------------
# 1. Banco
# ---------------------------------------------------------------------------
# --format=custom (não SQL puro): já sai comprimido, permite restaurar UMA
# tabela sem subir o dump inteiro, e é o formato que `pg_restore --list` sabe
# conferir — que é como validamos o arquivo logo abaixo.
DUMP="$TMP/ronan-${DATA}.dump"
log "gerando dump do banco"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  -f "$DUMP"

# Um dump truncado tem o mesmo cheiro de um dump bom: existe e tem tamanho.
# `pg_restore --list` abre o índice interno e falha se o arquivo estiver
# incompleto ou corrompido — é a diferença entre ter backup e achar que tem.
log "conferindo integridade do dump"
if ! pg_restore --list "$DUMP" > "$TMP/indice.txt" 2>"$TMP/erro.txt"; then
  avisar_falha "dump ilegível: $(head -c 300 "$TMP/erro.txt")"
  exit 1
fi

TABELAS=$(grep -c "TABLE DATA" "$TMP/indice.txt" || true)
BYTES=$(stat -c%s "$DUMP" 2>/dev/null || stat -f%z "$DUMP")
log "dump ok: $((BYTES / 1024 / 1024)) MB, $TABELAS tabelas com dados"

# Banco vazio passa em todas as checagens acima. Este piso existe porque o
# cenário mais perigoso não é o dump que falha (esse grita), é o dump que sai
# perfeito de um banco que já foi apagado — e sobrescreve o histórico bom.
if [ "${TABELAS:-0}" -lt 10 ]; then
  avisar_falha "dump saiu com só $TABELAS tabelas com dados — banco vazio ou errado? NÃO enviado."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Envio pro destino (R2)
# ---------------------------------------------------------------------------
log "configurando destino"
mc alias set destino "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" --api S3v4 >/dev/null

log "enviando dump"
mc cp "$DUMP" "destino/${BACKUP_S3_BUCKET}/banco/${DIA}/ronan-${DATA}.dump"

# Confere que o arquivo chegou com o tamanho certo. `mc cp` já falharia num
# erro de rede, mas upload truncado que retorna 0 existe e é justamente o que
# ninguém percebe até precisar restaurar.
REMOTO=$(mc stat --json "destino/${BACKUP_S3_BUCKET}/banco/${DIA}/ronan-${DATA}.dump" 2>/dev/null \
         | sed -n 's/.*"size":\([0-9]*\).*/\1/p' | head -1)
if [ "${REMOTO:-0}" != "$BYTES" ]; then
  avisar_falha "dump chegou com tamanho diferente (local $BYTES, remoto ${REMOTO:-?})"
  exit 1
fi
log "dump confirmado no destino ($((BYTES / 1024 / 1024)) MB)"

# ---------------------------------------------------------------------------
# 3. Fotos
# ---------------------------------------------------------------------------
# Foto de ticket é insubstituível: é a evidência que sustenta o faturamento e
# não tem como ser tirada de novo três meses depois.
#
# `mirror` sem --remove de propósito. Com --remove, alguém apagando as fotos no
# MinIO faria o backup replicar o apagamento na próxima madrugada — o backup
# viraria cúmplice do estrago em vez de defesa contra ele. Aqui o destino só
# cresce; some do MinIO, continua no R2.
if [ -n "${MINIO_ENDPOINT:-}" ] && [ -n "${MINIO_ACCESS_KEY:-}" ] && [ -n "${MINIO_SECRET_KEY:-}" ]; then
  BUCKET_FOTOS="${MINIO_BUCKET:-ronan-tickets}"
  log "espelhando fotos do bucket $BUCKET_FOTOS"
  mc alias set origem "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null
  # Incremental: só sobe o que ainda não está lá. A primeira noite é lenta
  # (sobe o acervo inteiro), as seguintes levam segundos.
  mc mirror --overwrite "origem/${BUCKET_FOTOS}" "destino/${BACKUP_S3_BUCKET}/fotos/${BUCKET_FOTOS}"
  N_FOTOS=$(mc ls --recursive "destino/${BACKUP_S3_BUCKET}/fotos/${BUCKET_FOTOS}" 2>/dev/null | wc -l | tr -d ' ')
  log "fotos espelhadas: $N_FOTOS objetos no destino"
else
  # Não é erro fatal (o banco já está salvo), mas também não pode passar como
  # se estivesse tudo certo: sem isso você descobre no dia D que "tinha backup"
  # e ele não tinha nenhuma foto.
  log "AVISO: MINIO_* não configurado — as FOTOS ficaram de fora deste backup"
  if [ -n "${BACKUP_ALERTA_URL:-}" ]; then
    curl -fsS -m 20 -X POST "$BACKUP_ALERTA_URL" \
      -H "content-type: application/json" \
      ${BACKUP_ALERTA_TOKEN:+-H "x-backup-token: $BACKUP_ALERTA_TOKEN"} \
      -d '{"evento":"backup-parcial","motivo":"MINIO_* nao configurado: fotos fora do backup"}' \
      -o /dev/null 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------------------
# 4. Pronto
# ---------------------------------------------------------------------------
# Nenhuma limpeza aqui — ver o cabeçalho. A retenção é regra do R2.
ping_monitor ""
log "concluído: banco/${DIA}/ronan-${DATA}.dump"
