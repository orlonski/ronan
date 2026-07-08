# Valhalla — roteador de navegação turn-by-turn (voz em pt-BR) pro guia ao vivo
# do app do motorista. ADITIVO ao OSRM: o km de faturamento continua no OSRM;
# o Valhalla serve SÓ a navegação (rota + manobras faladas).
#
# Usa a imagem gis-ops/docker-valhalla, que CONSTRÓI os tiles no primeiro start
# a partir do PBF (env `tile_urls`) e cacheia no volume /custom_files — evita
# build-time gigante/estouro de RAM no Easypanel. Config toda por env (ver README).
#
# Porta: 8002. NÃO expor publicamente — só rede interna (ronan-api → http://ronan-valhalla:8002).
FROM ghcr.io/gis-ops/docker-valhalla/valhalla:latest

# Defaults; podem ser sobrescritos por env no Easypanel. O entrypoint da imagem
# lê estes env e (re)constrói os tiles quando não existem no volume.
ENV tile_urls="https://download.geofabrik.de/south-america/brazil/sul-latest.osm.pbf" \
    use_tiles_ignore_pbf="True" \
    build_admins="True" \
    build_time_zones="True" \
    serve_tiles="True" \
    force_rebuild="False"

EXPOSE 8002
