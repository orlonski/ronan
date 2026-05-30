# OSRM — servidor de roteamento

Container que calcula rota carga→descarga em KM real seguindo estradas (OpenStreetMap).
Usado pelo `ronan-api` no endpoint `GET /m/rotas/calcular`.

## Profile: caminhão (truck)

O Dockerfile gera `truck.lua` patchando o `car.lua` oficial durante o build:

- **`hgv` adicionado ao topo da `access_tags_hierarchy`** — respeita tags
  específicas de caminhão pesado no OSM (`hgv=no` bloqueia a via,
  `hgv=designated` prioriza).
- **Velocidades reduzidas em vias urbanas** — `residential=15km/h`,
  `living_street=8km/h`, `service=10km/h`. Como o OSRM equilibra duração x
  distância, vias urbanas ficam menos atrativas → motor tende a desviar
  pra rodovias mesmo que seja um pouco mais longo.

O patch via `sed` é defensivo: se uma versão futura do `car.lua` mudar
os padrões, o build segue com o profile original sem quebrar. O `diff`
roda no build pra deixar rastro nos logs.

Pra adicionar restrições estritas (max_weight/max_height) seria preciso
escrever profile do zero — fora do escopo atual porque o OSM brasileiro
tem cobertura ruim dessas tags.

## Deploy no Easypanel

1. **Criar serviço Docker novo**
   - Nome: `ronan-osrm`
   - Tipo: App (Build from Dockerfile)
   - Source: este repo, path `infra/osrm`
   - Porta interna: `5000`
   - **Não expor publicamente** — só rede interna (acesso via `http://ronan-osrm:5000` do `ronan-api`).

2. **Build args (opcional)**
   - `REGION=sul` (default — cobre PR/SC/RS, ~700MB download, ~1.5GB imagem final)
   - Pra trocar: `REGION=brazil` (cobertura nacional, ~3GB imagem, ~3GB RAM em runtime)

3. **Recursos recomendados**
   - RAM: 2GB (Sul) / 4GB (Brasil)
   - Disco: 3GB (Sul) / 8GB (Brasil)
   - Build leva ~30-60 min na primeira vez (download + pre-processamento). Os builds seguintes usam cache de layers.

4. **Variável no `ronan-api`**
   ```
   OSRM_URL=http://ronan-osrm:5000
   ```

## Testar manualmente

```bash
# Curitiba → Joinville (deve retornar ~130km)
curl 'http://ronan-osrm:5000/route/v1/driving/-49.27,-25.43;-48.85,-26.30?overview=false'
```

Resposta esperada: `routes[0].distance` em metros, `routes[0].duration` em segundos.

## Atualizar mapa

OSM atualiza diariamente. Pra pegar mapa novo, rebuild do container (descarta cache do `wget`).
