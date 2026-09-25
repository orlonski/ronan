#!/usr/bin/env bash
# Monta os tiles do Valhalla NA VPS, fora do Easypanel, sem encostar no serviço no ar.
#
# Uso (da sua máquina, na pasta do repositório):
#   ssh -i ~/.ssh/id_ed25519_servidor root@149.102.138.127 'bash -s' < scripts/valhalla-preparar-mapa.sh
#
# Mesma receita do scripts/osrm-preparar-mapa.sh: container com teto de memória,
# pasta NOVA e datada, teste numa porta interna, e nada no ar é trocado.
#
# A imagem usada é a MESMA do container `ronan_valhalla` que está rodando (não um
# `:latest` recém-baixado): tile de uma versão do Valhalla nem sempre é lido por
# outra. Assim, a troca no Easypanel é só apontar a montagem /custom_files pra
# pasta nova — a fonte do serviço não muda.
#
# Resultado em /opt/valhalla-mapa/<REGIAO>-<AAAAMMDD>/. Acompanhar:
#   tail -f /opt/valhalla-mapa/preparo.log
set -euo pipefail

REGIAO="${REGIAO:-brazil}"
BASE=/opt/valhalla-mapa
DIR="${DIR:-$BASE/$REGIAO-$(date +%Y%m%d)}"
URL="https://download.geofabrik.de/south-america/${REGIAO}-latest.osm.pbf"
[ "$REGIAO" = "sul" ] && URL="https://download.geofabrik.de/south-america/brazil/sul-latest.osm.pbf"

if docker ps -a --format '{{.Names}}' | grep -qE '^valhalla-(preparo|teste)$'; then
  echo "Já existe um preparo/teste rodando. Acompanhe: tail -f $BASE/preparo.log"
  exit 1
fi

VIVO=$(docker ps -qf name=ronan_valhalla | head -1)
if [ -z "$VIVO" ]; then
  echo "Container ronan_valhalla não está rodando — sem ele não sei qual imagem usar."
  exit 1
fi
IMG=$(docker inspect --format '{{.Image}}' "$VIVO")
echo "imagem do Valhalla no ar: $IMG"

# Rede de segurança (a mesma do OSRM). Não recria se já existir.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 16G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
  swapon /swapfile
  echo "swap de 16 GB ligada"
fi

if [ -e "$DIR/valhalla.json" ]; then
  echo "$DIR já tem um mapa montado — não sobrescrevo (pode ser o que está no ar)."; exit 1
fi
mkdir -p "$DIR"
# A imagem roda com usuário próprio (não root) e escreve na pasta montada.
DONO=$(docker run --rm --entrypoint sh "$IMG" -c 'echo "$(id -u):$(id -g)"')
chown -R "$DONO" "$DIR"

cat > "$BASE/preparar.sh" <<EOF
set -e
echo "== \$(date '+%d/%m %H:%M') montando tiles de $URL (teto de 10 GB de RAM)"
# serve_tiles=False: monta e sai. server_threads limita o paralelismo (e a RAM).
docker run --rm --name valhalla-preparo --memory=10g --memory-swap=26g \\
  -v "$DIR:/custom_files" \\
  -e tile_urls="$URL" \\
  -e serve_tiles=False \\
  -e build_admins=True \\
  -e build_time_zones=True \\
  -e use_tiles_ignore_pbf=True \\
  -e force_rebuild=False \\
  -e server_threads=6 \\
  "$IMG"
ls -la "$DIR" | head -20
du -sh "$DIR"
[ -e "$DIR/valhalla.json" ] || { echo "ERRO: não gerou valhalla.json"; exit 1; }

echo "== \$(date '+%d/%m %H:%M') testando numa porta interna (127.0.0.1:8099)"
docker rm -f valhalla-teste >/dev/null 2>&1 || true
docker run -d --name valhalla-teste -p 127.0.0.1:8099:8002 \\
  -v "$DIR:/custom_files" \\
  -e tile_urls="$URL" \\
  -e serve_tiles=True \\
  -e use_tiles_ignore_pbf=True \\
  -e force_rebuild=False \\
  "$IMG" >/dev/null
for i in \$(seq 1 60); do
  curl -sf http://127.0.0.1:8099/status >/dev/null && break
  sleep 5
done
teste() {
  corpo='{"locations":[{"lat":'\$2',"lon":'\$3'},{"lat":'\$4',"lon":'\$5'}],"costing":"truck","alternates":2,"directions_options":{"language":"pt-BR","units":"kilometers"}}'
  r=\$(curl -s -X POST http://127.0.0.1:8099/route -H 'Content-Type: application/json' -d "\$corpo")
  echo "\$1: \$(echo "\$r" | python3 -c 'import sys,json
d=json.load(sys.stdin)
t=d.get("trip")
if not t: print("SEM ROTA", d.get("error") or d); sys.exit()
alts=[round(a["trip"]["summary"]["length"]) for a in d.get("alternates",[])]
m=t["legs"][0]["maneuvers"]
print(round(t["summary"]["length"]), "km | alternativas:", alts, "| 2a manobra:", m[1]["instruction"] if len(m)>1 else m[0]["instruction"])' 2>&1)"
}
teste "Curitiba > Joinville (esperado ~130)" -25.43 -49.27 -26.30 -48.85
teste "Campinas > BH (esperado ~579)"        -22.90 -47.06 -19.92 -43.94
teste "Recife > Salvador (esperado ~806)"    -8.05 -34.88 -12.97 -38.50
docker stats --no-stream --format "RAM do Valhalla com o mapa novo: {{.MemUsage}}" valhalla-teste
docker rm -f valhalla-teste >/dev/null
echo "== \$(date '+%d/%m %H:%M') PRONTO. Mapa em $DIR — nada no ar foi trocado."
EOF

setsid nohup bash "$BASE/preparar.sh" > "$BASE/preparo.log" 2>&1 < /dev/null &
echo "Preparo do Valhalla ($REGIAO) iniciado em segundo plano em $DIR. Leva ~1h30 a 2h30."
echo "Acompanhar: tail -f $BASE/preparo.log"
