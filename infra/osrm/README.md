# OSRM — servidor de roteamento

Container que calcula rota carga→descarga em KM real seguindo estradas (OpenStreetMap).
Usado pelo `ronan-api` no endpoint `GET /m/rotas/calcular`.

## Como está em produção (desde 25/09/2026): Brasil inteiro, mapa em volume

O serviço `osrm` do Easypanel **não é mais construído deste Dockerfile**. Ele roda a
imagem pronta `osrm/osrm-backend:latest` servindo um mapa montado FORA do Easypanel:

- **Fonte:** Imagem Docker `osrm/osrm-backend:latest`
- **Montagem (bind):** `/opt/osrm-mapa/brazil` (host) → `/data`
- **Comando:** `osrm-routed --algorithm mld --port 5000 /data/mapa.osrm`
- RAM em uso: ~8,4 GB (o Sul usava 1,5 GB)

Por quê: pré-processar o Brasil passa de 12 GB de RAM no pico, e o build do Easypanel
roda sem teto na mesma VPS da API e do Postgres (que não tinha swap). O script
`scripts/osrm-preparar-mapa.sh` monta o mapa num container com `--memory=12g` + swap,
testa rotas numa porta interna e não troca nada do que está no ar. Levou ~2h15 na
primeira vez (extract ~1h45, com swap; partition+customize ~15 min).

### Atualizar o mapa

```bash
ssh -i ~/.ssh/id_ed25519_servidor root@149.102.138.127 'bash -s' < scripts/osrm-preparar-mapa.sh
```

O script monta numa pasta NOVA (`/opt/osrm-mapa/brazil-AAAAMMDD`) e se recusa a
escrever numa pasta que já tem mapa — a que está no ar é servida por bind, e reescrever
os arquivos dela por baixo derruba a rota. Quando o log disser PRONTO com os testes
certos: Armazenamento → Editar a montagem → Caminho do Host pra pasta nova → Implantar.
Depois, apagar a pasta antiga (~10 GB).

### Testar o que está no ar

O OSRM não tem domínio público. O teste sai de dentro do container da API:

```bash
ssh -i ~/.ssh/id_ed25519_servidor root@149.102.138.127 'bash -s' < scripts/osrm-testar.sh
```

### Voltar pro mapa do Sul

Fonte → Github (`orlonski/ronan`, `main`, Dockerfile `infra/osrm/Dockerfile`), apagar
o Comando e remover a montagem `/data` **antes** de implantar — com a montagem, o
`/data` da imagem do Sul fica escondido e o `osrm-routed` não acha o arquivo.

### Fora da cobertura

A API recusa rota cujo ponto precisou andar mais de 3 km até a estrada
(`ROTA_ENCAIXE_MAX_M`, ver `roteamento.service.ts`) — é o que protege o km faturado
quando o mapa não cobre o lugar.

## Dockerfile (legado: build do mapa pelo Easypanel)

### Profile: caminhão (truck)

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
