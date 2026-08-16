# Imagem do job de backup (`ronan_backup`): tira a cópia diária do banco e das
# fotos e manda pra fora do Contabo.
#
# Existe como imagem própria porque o job precisa de duas ferramentas que
# nenhuma imagem oficial traz juntas:
#   - pg_dump da MESMA major do servidor (prod é PG17; pg_dump mais antigo que o
#     servidor se recusa a rodar, e é o tipo de erro que só aparece no dia D);
#   - mc (MinIO Client), que fala S3 e serve tanto pro MinIO de origem quanto
#     pro R2 de destino.
#
# Não roda como serviço: é disparado pelo Cron do Easypanel. Ver docs/backup.md.
FROM postgres:17-alpine

# `mc` vem do binário oficial: a imagem minio/mc não tem pg_dump, e instalar
# Postgres em cima dela sairia com major errado.
RUN apk add --no-cache curl ca-certificates bash coreutils \
    && ARCH="$(uname -m)" \
    && case "$ARCH" in \
         x86_64)  MC_ARCH=amd64 ;; \
         aarch64) MC_ARCH=arm64 ;; \
         *) echo "arquitetura não suportada: $ARCH" && exit 1 ;; \
       esac \
    && curl -fsSL "https://dl.min.io/client/mc/release/linux-${MC_ARCH}/mc" -o /usr/local/bin/mc \
    && chmod +x /usr/local/bin/mc \
    && mc --version

COPY scripts/backup.sh /scripts/backup.sh
COPY scripts/restaurar-backup.sh /scripts/restaurar-backup.sh
RUN chmod +x /scripts/*.sh

# Sem CMD de servidor: o Cron do Easypanel chama /scripts/backup.sh direto.
ENTRYPOINT ["/bin/bash"]
CMD ["/scripts/backup.sh"]
