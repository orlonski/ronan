# Valhalla — navegação turn-by-turn (guia ao vivo estilo Waze)

Roteador open-source que devolve a rota **e as manobras faladas em português**
(`verbal_pre_transition_instruction` em `pt-BR`), perfil **truck** (caminhão, evita
ponte baixa/restrição de peso). Usado pelo `ronan-api` no endpoint `POST /m/rotas/navegar`,
que alimenta o guia ao vivo do app (só pra quem tem "Iniciar viagem com GPS").

**É aditivo:** o km de faturamento continua 100% no OSRM (`ronan-osrm`). O Valhalla NÃO
toca em nada de faturamento — serve só a navegação.

## Como funciona

A imagem `gis-ops/docker-valhalla` constrói os tiles do OpenStreetMap **no primeiro start**
(baixa o PBF de `tile_urls`, gera os tiles em `/custom_files`) e depois serve. O volume em
`/custom_files` cacheia os tiles — nos próximos starts sobe direto (rápido).

## Deploy no Easypanel

1. **Criar serviço Docker novo**
   - Nome: `ronan-valhalla`
   - Tipo: App (Build from Dockerfile), Source: este repo, path `infra/valhalla`
   - Porta interna: `8002`
   - **Não expor publicamente** — só rede interna (acesso via `http://ronan-valhalla:8002` do `ronan-api`).

2. **Volume (obrigatório)** — pra não reconstruir os tiles a cada restart:
   - Mount path: `/custom_files`

3. **Env (opcional — já vêm como default no Dockerfile)**
   ```
   tile_urls=https://download.geofabrik.de/south-america/brazil/sul-latest.osm.pbf
   use_tiles_ignore_pbf=True
   build_admins=True
   build_time_zones=True
   serve_tiles=True
   force_rebuild=False   # ponha True uma vez pra reconstruir com mapa novo
   ```
   Pra Brasil inteiro: troque `sul-latest` por `brazil-latest` (bem mais RAM/disco).

4. **Recursos recomendados (Sul do Brasil)**
   - RAM: 2–4 GB (o build de tiles é o pico; servir consome menos)
   - Disco: ~3 GB (tiles + PBF)
   - Primeiro start leva ~15–40 min (download + build dos tiles). Os próximos são rápidos (volume).

5. **Variável no `ronan-api`**
   ```
   VALHALLA_URL=http://ronan-valhalla:8002
   ```

## Testar manualmente

```bash
# Carga → descarga (ex.: rodovia da uva). costing truck + voz pt-BR.
curl -s http://ronan-valhalla:8002/route \
  -H 'Content-Type: application/json' \
  -d '{
    "locations":[{"lat":-25.4233493,"lon":-49.3858747},{"lat":-25.3425617,"lon":-49.2265567}],
    "costing":"truck",
    "directions_options":{"language":"pt-BR","units":"kilometers"}
  }' | python3 -m json.tool | head -60
```

Esperado: `trip.legs[0].shape` (polyline precisão 6) e `trip.legs[0].maneuvers[]` com
`instruction` e `verbal_pre_transition_instruction` **em português**, `begin_shape_index`,
`length`, `time`.

## Atualizar mapa

OSM atualiza diariamente. Pra pegar mapa novo: setar env `force_rebuild=True` e reiniciar
uma vez (reconstrói os tiles do PBF atual), depois voltar pra `False`.
