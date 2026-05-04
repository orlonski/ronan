# OSRM (Open Source Routing Machine) com mapa Sul do Brasil pre-processado.
#
# Build leva 30-60min (download ~700MB + pre-processamento) e gasta ~3GB de RAM.
# Pre-processamento roda em build-time (multi-stage) e fica embutido na imagem final.
#
# Pra trocar pra Brasil inteiro, mude REGION pra "brazil" (cuidado: ~3GB RAM em runtime).

FROM osrm/osrm-backend:latest AS build

ARG REGION=sul
ARG OSM_URL=https://download.geofabrik.de/south-america/brazil/${REGION}-latest.osm.pbf

WORKDIR /data

RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN wget --progress=dot:giga -O /data/${REGION}.osm.pbf "${OSM_URL}" \
    && osrm-extract -p /opt/car.lua /data/${REGION}.osm.pbf \
    && osrm-partition /data/${REGION}.osrm \
    && osrm-customize /data/${REGION}.osrm \
    && rm /data/${REGION}.osm.pbf

FROM osrm/osrm-backend:latest

ARG REGION=sul
ENV REGION=${REGION}

COPY --from=build /data /data

EXPOSE 5000

CMD osrm-routed --algorithm mld --port 5000 /data/${REGION}.osrm
