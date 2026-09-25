#!/usr/bin/env bash
# Prepara o mapa do OSRM NA VPS, fora do Easypanel, sem encostar no serviço no ar.
#
# Uso (da sua máquina):
#   ssh -i ~/.ssh/id_ed25519_servidor root@149.102.138.127 'bash -s' < scripts/osrm-preparar-mapa.sh
#
# Por que assim e não pelo build do Easypanel: o pré-processamento do Brasil passa
# de 10 GB de RAM no pico, e o build do Easypanel roda sem teto na mesma máquina da
# API e do Postgres (e sem swap, o OOM killer escolhe a vítima). Aqui ele roda num
# container com --memory: se estourar, morre só ele.
#
# Resultado em /opt/osrm-mapa/<REGIAO>/ (arquivos .osrm.*), prontos pra montar como
# volume num osrm-routed. Nada no ar é trocado por este script. Acompanhar:
#   tail -f /opt/osrm-mapa/preparo.log
set -euo pipefail

REGIAO="${REGIAO:-brazil}"
BASE=/opt/osrm-mapa
DIR="$BASE/$REGIAO"
URL="https://download.geofabrik.de/south-america/${REGIAO}-latest.osm.pbf"
[ "$REGIAO" = "sul" ] && URL="https://download.geofabrik.de/south-america/brazil/sul-latest.osm.pbf"

if docker ps -a --format '{{.Names}}' | grep -qx osrm-preparo; then
  echo "Já existe um preparo rodando (container osrm-preparo). Acompanhe: tail -f $BASE/preparo.log"
  exit 1
fi

# Rede de segurança: a VPS não tem swap. 16 GB no disco (sobra 100 GB).
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 16G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
  swapon /swapfile
  echo "swap de 16 GB ligada"
fi

mkdir -p "$DIR"

# O profile de caminhão é o MESMO do infra/osrm/Dockerfile (car.lua + 2 patches).
# Fica dentro do container porque o car.lua faz require("lib/...") relativo a /opt.
cat > "$DIR/processar.sh" <<'EOF'
set -e
cp /opt/car.lua /opt/truck.lua
sed -i "s/Sequence *{ *'motorcar'/Sequence { 'hgv', 'motorcar'/" /opt/truck.lua
sed -i "s/residential *= *[0-9]\+/residential = 15/" /opt/truck.lua
sed -i "s/living_street *= *[0-9]\+/living_street = 8/" /opt/truck.lua
sed -i "s/service *= *[0-9]\+/service = 10/" /opt/truck.lua
echo "=== truck.lua diff vs car.lua ==="
diff /opt/car.lua /opt/truck.lua || true
osrm-extract -p /opt/truck.lua /data/mapa.osm.pbf
osrm-partition /data/mapa.osrm
osrm-customize /data/mapa.osrm
EOF

cat > "$BASE/preparar.sh" <<EOF
set -e
echo "== \$(date '+%d/%m %H:%M') baixando $URL"
curl -fL --retry 3 -o "$DIR/mapa.osm.pbf" "$URL"
ls -lh "$DIR/mapa.osm.pbf"

echo "== \$(date '+%d/%m %H:%M') pré-processando (teto de 12 GB de RAM)"
docker run --rm --name osrm-preparo --memory=12g --memory-swap=28g \\
  -v "$DIR:/data" osrm/osrm-backend:latest sh /data/processar.sh
rm -f "$DIR/mapa.osm.pbf"
du -sh "$DIR"

echo "== \$(date '+%d/%m %H:%M') testando numa porta interna (127.0.0.1:5099)"
docker rm -f osrm-teste >/dev/null 2>&1 || true
docker run -d --name osrm-teste -p 127.0.0.1:5099:5000 -v "$DIR:/data" \\
  osrm/osrm-backend:latest osrm-routed --algorithm mld /data/mapa.osrm >/dev/null
sleep 60
teste() {
  r=\$(curl -s "http://127.0.0.1:5099/route/v1/driving/\$2?overview=false")
  echo "\$1: \$(echo "\$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["code"], round(d["routes"][0]["distance"]/1000), "km | encaixe (m):", [round(w["distance"]) for w in d["waypoints"]]) if d.get("routes") else print(d)' 2>&1)"
}
teste "Curitiba > Joinville (esperado ~130)"  "-49.27,-25.43;-48.85,-26.30"
teste "Campinas > Belo Horizonte (~590)"      "-47.06,-22.90;-43.94,-19.92"
teste "Recife > Salvador (~800)"              "-34.88,-8.05;-38.50,-12.97"
teste "Goiânia > Cuiabá (~890)"               "-49.25,-16.68;-56.10,-15.60"
docker stats --no-stream --format "RAM do OSRM com o mapa novo: {{.MemUsage}}" osrm-teste
docker rm -f osrm-teste >/dev/null
echo "== \$(date '+%d/%m %H:%M') PRONTO. Mapa em $DIR — nada no ar foi trocado."
EOF

setsid nohup bash "$BASE/preparar.sh" > "$BASE/preparo.log" 2>&1 < /dev/null &
echo "Preparo do mapa ($REGIAO) iniciado em segundo plano. Leva ~1h."
echo "Acompanhar: tail -f $BASE/preparo.log"
