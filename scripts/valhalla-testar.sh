#!/usr/bin/env bash
# Testa o Valhalla NO AR, de dentro do container da API (o mesmo VALHALLA_URL que
# ela usa). O Valhalla não tem domínio público.
#
# Uso (da sua máquina, na pasta do repositório):
#   ssh -i ~/.ssh/id_ed25519_servidor root@149.102.138.127 'bash -s' < scripts/valhalla-testar.sh
set -uo pipefail

API=$(docker ps -qf name=ronan_api | head -1)
[ -z "$API" ] && { echo "container da API não encontrado"; exit 1; }

teste() {
  docker exec "$API" node -e '
    const [nome, a, b, c, d] = process.argv.slice(1).map((x, i) => (i ? Number(x) : x));
    fetch(process.env.VALHALLA_URL + "/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [{ lat: a, lon: b }, { lat: c, lon: d }],
        costing: "truck",
        alternates: 2,
        directions_options: { language: "pt-BR", units: "kilometers" },
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.trip) return console.log(nome + ": SEM ROTA", JSON.stringify(j).slice(0, 200));
        const alts = (j.alternates || []).map((x) => Math.round(x.trip.summary.length));
        console.log(nome + ":", Math.round(j.trip.summary.length) + " km | alternativas:", alts.join(", ") || "nenhuma");
      })
      .catch((e) => console.log(nome + ": ERRO", e.message));
  ' "$@"
}

teste "Curitiba > Joinville (esperado ~130)" -25.43 -49.27 -26.30 -48.85
teste "Campinas > BH (esperado ~579)"        -22.90 -47.06 -19.92 -43.94
teste "Recife > Salvador (esperado ~806)"    -8.05 -34.88 -12.97 -38.50
docker stats --no-stream --format "{{.Name}} {{.MemUsage}}" | grep valhalla
