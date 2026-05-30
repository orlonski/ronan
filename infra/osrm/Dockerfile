# OSRM (Open Source Routing Machine) com mapa Sul do Brasil pre-processado,
# usando profile TRUCK derivado do car.lua oficial com 2 patches:
#   1) hgv no inicio da access_tags_hierarchy -> respeita tag hgv:no/yes
#   2) speeds reduzidas em vias urbanas -> motorista de caminhao
#      tende a evitar bairros (rate menor = penalidade no roteamento)
#
# Build leva 30-60min (download ~700MB + pre-processamento) e gasta ~3GB de RAM.
# Pre-processamento roda em build-time (multi-stage) e fica embutido na imagem final.
#
# Pra trocar pra Brasil inteiro, mude REGION pra "brazil" (cuidado: ~3GB RAM em runtime).

# Stage 1: baixa o .osm.pbf usando Debian 12 (a imagem osrm-backend e' Debian Stretch EOL).
FROM debian:12-slim AS downloader

ARG REGION=sul
ARG OSM_URL=https://download.geofabrik.de/south-america/brazil/${REGION}-latest.osm.pbf

RUN apt-get update \
    && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN wget --progress=dot:giga -O /tmp/region.osm.pbf "${OSM_URL}"

# Stage 2: pre-processamento com osrm-extract / partition / customize.
FROM osrm/osrm-backend:latest AS build

ARG REGION=sul

WORKDIR /data
COPY --from=downloader /tmp/region.osm.pbf /data/${REGION}.osm.pbf

# Gera /opt/truck.lua patchando /opt/car.lua oficial:
#  - Adiciona 'hgv' no topo da access_tags_hierarchy (Sequence { 'hgv', 'motorcar', ... })
#  - Reduz velocidades de vias urbanas (residential, living_street, service)
#  Os sed sao defensivos: se nao encontram o pattern (mudanca futura no car.lua),
#  o build segue com car.lua original mas o RUN inicial garante que o /opt/truck.lua
#  exista. Os patches sao loggados.
RUN cp /opt/car.lua /opt/truck.lua \
    && sed -i "s/Sequence *{ *'motorcar'/Sequence { 'hgv', 'motorcar'/" /opt/truck.lua \
    && sed -i "s/residential *= *[0-9]\+/residential = 15/" /opt/truck.lua \
    && sed -i "s/living_street *= *[0-9]\+/living_street = 8/" /opt/truck.lua \
    && sed -i "s/service *= *[0-9]\+/service = 10/" /opt/truck.lua \
    && echo "=== truck.lua diff vs car.lua ===" \
    && diff /opt/car.lua /opt/truck.lua || true

RUN osrm-extract -p /opt/truck.lua /data/${REGION}.osm.pbf \
    && osrm-partition /data/${REGION}.osrm \
    && osrm-customize /data/${REGION}.osrm \
    && rm /data/${REGION}.osm.pbf

# Stage 3: imagem final, so com os arquivos .osrm.* + binario.
FROM osrm/osrm-backend:latest

ARG REGION=sul
ENV REGION=${REGION}

COPY --from=build /data /data

EXPOSE 5000

CMD osrm-routed --algorithm mld --port 5000 /data/${REGION}.osrm
