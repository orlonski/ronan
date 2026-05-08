# Subir Evolution API no Easypanel

Guia pra subir Evolution API self-hosted no Easypanel pra integração WhatsApp do Ronan. Reflete o setup que funcionou na produção (2026-05-08) — siga com atenção, em particular nos pontos marcados ⚠️.

## 1. Service `evolution`

No Easypanel → projeto Ronan → **+ Service → Docker Image**:

| Campo | Valor |
|---|---|
| Name | `evolution` |
| Image | `evoapicloud/evolution-api:v2.3.7` ⚠️ **NÃO use `atendai/evolution-api`** — está abandonada e tem bug que trava QR em loop infinito |

> ℹ️ Pode usar `evoapicloud/evolution-api:latest` se preferir update automático, mas pin numa tag fixa é mais seguro.

### Environment

```env
# Auth
AUTHENTICATION_API_KEY=<gere com `openssl rand -hex 32` — NÃO deixe placeholder>

# Servidor
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://evolution.SEU-DOMINIO.com  # troca pelo domínio real do Easypanel

# CORS
CORS_ORIGIN=*
CORS_METHODS=POST,GET,PUT,DELETE
CORS_CREDENTIALS=true

# Logs
LOG_LEVEL=ERROR,WARN,INFO,LOG
LOG_COLOR=false

# Banco — Postgres
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres:SENHA_FORTE@PROJETO_evolution-postgres:5432/evolution?schema=public
DATABASE_CONNECTION_CLIENT_NAME=evolution_<projeto>
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

# Cache — RECOMENDADO desligar Redis e usar local. Redis self-hosted no Easypanel
# desconectava aleatoriamente e quebrava sessão WhatsApp.
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

# Webhook GLOBAL — toda mensagem recebida vai pra nossa API
WEBHOOK_GLOBAL_URL=https://api.SEU-DOMINIO.com/whatsapp/webhook  # troca pelo domínio real
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
```

⚠️ **Detalhes que vão te derrubar se errar:**

1. **Hostname do Postgres** no Easypanel é `<projeto>_<service>` (com underscore, prefix do projeto). Ex: se o projeto é `ronan` e o service é `evolution-postgres`, o hostname interno é `ronan_evolution-postgres` — não é `evolution-postgres` puro.
2. **`SERVER_URL`** precisa ser o domínio público REAL — usado pra montar links internos do Evolution. Placeholder não substituído trava o Baileys.
3. **`WEBHOOK_GLOBAL_URL`** idem — aponta pra API do Ronan.
4. **`AUTHENTICATION_API_KEY`** com placeholder permite qualquer um acessar tua instância → mandar/ler mensagens em nome da empresa. **Sempre gere valor seguro.**

### Mounts ⚠️ obrigatório

Adiciona **Montagem de volume** (não bind mount, não montagem de arquivo):

| Campo | Valor |
|---|---|
| Nome | `evolution-instances` |
| Caminho | `/evolution/instances` |

> Sem esse volume, Baileys não persiste credenciais da sessão WhatsApp e **fica em loop** tentando autenticar.

### Domains

Aba **Domains** → adiciona domínio (ou usa o gerado pelo Easypanel) **na porta 8080**.

## 2. Service `<projeto>_evolution-postgres`

`+ Service → Docker Image`:
- Image: `postgres:16-alpine`
- Environment:
  ```
  POSTGRES_DB=evolution
  POSTGRES_USER=postgres
  POSTGRES_PASSWORD=<gere senha forte só com letras+números>
  ```
- Mounts: volume `evolution-postgres-data` em `/var/lib/postgresql/data`

⚠️ **Use senha sem caracteres especiais** (`@:/#?&+%`) — se precisar usar, faça URL-encode na `DATABASE_CONNECTION_URI`. É mais simples só usar alfanumérico.

⚠️ **Volume é obrigatório** — sem ele, todo restart o Postgres começa do zero.

## 3. Pareamento

Não use o Manager web do Evolution v2.x — bugado. Usa a API direto:

```bash
# Cria instância
curl -X POST \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"ronan","integration":"WHATSAPP-BAILEYS","qrcode":true}' \
  https://evolution.SEU-DOMINIO.com/instance/create

# Pega QR (espera ~10s depois do create)
curl -H "apikey: SUA_API_KEY" \
  https://evolution.SEU-DOMINIO.com/instance/connect/ronan
```

A resposta vem com `base64` (imagem do QR) ou `pairingCode` (8 chars pra colar no celular sem QR).

**No celular:** WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneia QR ou clica "Conectar com número de telefone" pra usar pairing code.

## 4. Configuração na API do Ronan

No service da **API do Ronan** (não do Evolution), adiciona:

```env
EVOLUTION_API_URL=https://evolution.SEU-DOMINIO.com  # mesmo domínio do passo 1
EVOLUTION_API_KEY=<o mesmo AUTHENTICATION_API_KEY>
EVOLUTION_INSTANCE=ronan
```

Reinicia API. Painel `/whatsapp` no dashboard mostra status verde com número conectado.

## 5. Validação end-to-end

1. De um celular **diferente** do pareado, manda "oi" pro número da empresa
2. Bot responde pedindo código de convite
3. No dashboard, vai em Motoristas → ícone WhatsApp num motorista → copia código
4. No celular de teste, manda só o código
5. Bot responde "Beleza, [Nome]! Você foi vinculado(a)..."
6. Manda "ping" → "pong 🏓"
7. Painel `/whatsapp` mostra a sessão vinculada e histórico das mensagens

## Troubleshooting (vivido)

| Sintoma | Causa | Fix |
|---|---|---|
| Tudo retorna `{"count": 0}` no `/instance/connect`, logs do Evolution só mostram "Group Ignore: false" em loop | Versão `atendai/evolution-api:v2.2.3` tem bug do QR | Trocar pra `evoapicloud/evolution-api:v2.3.7+` |
| `redis disconnected` nos logs do Evolution | Hostname do Redis errado ou Redis instável | Desabilitar Redis: `CACHE_REDIS_ENABLED=false`, `CACHE_LOCAL_ENABLED=true` |
| `getaddrinfo ENOTFOUND api.seu-dominio.com` no webhook | Placeholder não substituído em `WEBHOOK_GLOBAL_URL` | Trocar pelo domínio real |
| `401 Unauthorized` ao webhook | API tem JWT global e webhook precisa ser público | Decorator `@Public()` no endpoint do webhook |
| Domínio retorna 404 do Easypanel mas service tá verde | Aba Domains não mapeada pra porta 8080 | Configurar domínio do service na porta 8080 |
| `Authentication failed against database server` | Volume do Postgres tem senha antiga (gravada na primeira inicialização) | Apagar volume `evolution-postgres-data` e deixar Postgres recriar |

## Custo

~0 — só consumo de RAM/CPU do Easypanel/VPS. Evolution + Postgres juntos rodam confortavelmente em 512MB/0.2 CPU.
