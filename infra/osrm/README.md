# OSRM — servidor de roteamento

Container que calcula rota carga→descarga em KM real seguindo estradas (OpenStreetMap).
Usado pelo `ronan-api` no endpoint `GET /m/rotas/calcular`.

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
