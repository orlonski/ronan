# Subir Evolution API no Easypanel

Guia rápido pra subir o Evolution API v2 self-hosted no Easypanel pra integração WhatsApp do Ronan. **Você executa**, eu não tenho credencial Easypanel.

## 1. Criar serviço

No Easypanel, dentro do projeto Ronan, clica em **"+ Service" → "Docker Image"**.

| Campo | Valor |
|---|---|
| Name | `evolution` |
| Image | `atendai/evolution-api:v2.2.3` (versão fixa pra evitar surpresas em update) |

## 2. Variáveis de ambiente

Cole no **Environment** do serviço:

```env
# Auth — TROCA pra um valor secreto teu (gera com `openssl rand -hex 32`)
AUTHENTICATION_API_KEY=COLE_UM_TOKEN_LONGO_E_SECRETO_AQUI

# Servidor
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://evolution.SEU-DOMINIO.com

# CORS — libera só a API do Ronan e localhost
CORS_ORIGIN=*
CORS_METHODS=POST,GET,PUT,DELETE
CORS_CREDENTIALS=true

# Logs
LOG_LEVEL=ERROR,WARN,INFO,LOG
LOG_COLOR=false

# Banco — Evolution v2 precisa de Postgres
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres:SENHA@evolution-postgres:5432/evolution?schema=public
DATABASE_CONNECTION_CLIENT_NAME=evolution_ronan
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

# Cache (Redis opcional, mas recomendado — sem ele, sessão WhatsApp se perde no restart)
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://evolution-redis:6379/6
CACHE_REDIS_PREFIX_KEY=evolution_ronan
CACHE_REDIS_SAVE_INSTANCES=true
CACHE_LOCAL_ENABLED=false

# Webhook GLOBAL — toda mensagem recebida vai pra nossa API
WEBHOOK_GLOBAL_URL=https://api.SEU-DOMINIO.com/whatsapp/webhook
WEBHOOK_GLOBAL_ENABLED=true
WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false
WEBHOOK_EVENTS_MESSAGES_UPSERT=true
WEBHOOK_EVENTS_CONNECTION_UPDATE=true
WEBHOOK_EVENTS_QRCODE_UPDATED=true

# Sessão
DEL_INSTANCE=false
LANGUAGE=pt-BR

# Telemetria off
TELEMETRY=false
TELEMETRY_URL=
```

## 3. Postgres + Redis (sidecars)

Evolution v2 precisa de Postgres. **Cria 2 services adicionais no mesmo projeto:**

### `evolution-postgres`

- Image: `postgres:16-alpine`
- Environment:
  ```
  POSTGRES_DB=evolution
  POSTGRES_USER=postgres
  POSTGRES_PASSWORD=COLOCA_UMA_SENHA_FORTE
  ```
- Volume: `/var/lib/postgresql/data` → `evolution-postgres-data`
- **Não precisa expor porta** — só comunica internamente com o evolution

### `evolution-redis`

- Image: `redis:7-alpine`
- **Sem env vars necessárias**
- Volume: `/data` → `evolution-redis-data`
- **Não precisa expor porta**

## 4. Volume e domínio do `evolution`

- Volume: `/evolution/instances` → `evolution-instances` (persistência das sessões/QR)
- Domain: cria subdomínio `evolution.SEU-DOMINIO.com` apontando pro service `evolution` na porta `8080`
- **HTTPS obrigatório** — WhatsApp não conecta em HTTP

## 5. Subir e testar

1. Deploy. Aguarda os 3 services ficarem verde.
2. Acessa `https://evolution.SEU-DOMINIO.com/manager` no navegador.
3. Login: cola o valor de `AUTHENTICATION_API_KEY`.
4. Cria instância nova: nome `ronan` (ou outro que lembre).
5. Clica **"Connect"** → mostra QR code.
6. Abre WhatsApp no celular do número da empresa → **Configurações → Aparelhos conectados → Conectar um aparelho** → escaneia o QR.
7. Status da instância vira "open" (conectado).

## 6. Me passa pra eu plugar no backend

Depois que tiver tudo no ar, me manda:

```
EVOLUTION_API_URL=https://evolution.SEU-DOMINIO.com
EVOLUTION_API_KEY=<o mesmo AUTHENTICATION_API_KEY>
EVOLUTION_INSTANCE=ronan
```

Eu adiciono no `.env` do backend e configura o webhook automático apontando pra nossa API. Aí teste manda "oi" pro número conectado e o webhook chega.

## Troubleshooting

- **QR não aparece**: container deve ter Redis rodando, senão sessão não persiste. Olha logs do `evolution-redis`.
- **Webhook não chega**: confirma que `https://api.SEU-DOMINIO.com/whatsapp/webhook` é acessível externamente (sem firewall) e que o Evolution consegue resolver o DNS.
- **WhatsApp deslogou sozinho**: Baileys reconecta automático na maioria dos casos. Se não, escaneia o QR de novo.
- **Atualizar versão**: troca a tag da image (`v2.2.3` → `v2.2.x`) e redeploya. Sessão persiste no volume.

## Custo

Aproximadamente **0** — Evolution é open source, tudo roda no teu Easypanel/Contabo. Único custo é a memória/CPU do container (~256MB RAM/0.1 CPU pro Evolution + Postgres + Redis).
