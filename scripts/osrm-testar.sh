#!/usr/bin/env bash
# Testa o OSRM NO AR, de dentro do container da API (o mesmo OSRM_URL que ela usa).
# O OSRM não tem domínio público, então não dá pra testar de fora.
#
# Uso (da sua máquina):
#   ssh -i ~/.ssh/id_ed25519_servidor root@149.102.138.127 'bash -s' < scripts/osrm-testar.sh
set -uo pipefail

API=$(docker ps -qf name=ronan_api | head -1)
[ -z "$API" ] && { echo "container da API não encontrado"; exit 1; }

teste() {
  docker exec "$API" node -e '
    const [nome, c] = process.argv.slice(1);
    fetch(process.env.OSRM_URL + "/route/v1/driving/" + c + "?overview=false")
      .then((r) => r.json())
      .then((d) => console.log(nome + ":", d.code,
        d.routes ? Math.round(d.routes[0].distance / 1000) + " km" : "",
        "| encaixe:", (d.waypoints || []).map((w) => Math.round(w.distance) + "m").join(" ")))
      .catch((e) => console.log(nome + ": ERRO", e.message));
  ' "$1" "$2"
}

teste "Curitiba > Joinville (esperado ~130)" "-49.27,-25.43;-48.85,-26.30"
teste "Campinas > BH (esperado ~579)"        "-47.06,-22.90;-43.94,-19.92"
teste "Recife > Salvador (esperado ~806)"    "-34.88,-8.05;-38.50,-12.97"
docker stats --no-stream --format "{{.Name}} {{.MemUsage}}" | grep osrm
