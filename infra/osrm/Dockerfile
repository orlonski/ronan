# OSRM (Open Source Routing Machine) com mapa Sul do Brasil pre-processado.
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

RUN osrm-extract -p /opt/car.lua /data/${REGION}.osm.pbf \
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
