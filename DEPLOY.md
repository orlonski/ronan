# Deploy do Ronan no Easypanel + Contabo

Guia passo-a-passo pra subir o sistema em produção. Pressuposto: VPS Contabo com Easypanel já instalado.

## Pré-requisitos

- VPS Contabo (recomendo mínimo: 4 vCPU, 8GB RAM, 200GB SSD)
- Easypanel rodando e acessível via HTTPS
- Domínio apontando pra IP da VPS (registros A pra `painel.`, `app.`, `api.`)
- Repositório Git em https://github.com/orlonski/ronan (já está)
- Conta Anthropic com chave de API (sk-ant-...)

## Estrutura final

5 serviços rodando no Easypanel, todos no mesmo projeto chamado `ronan`:

| Serviço | Tipo | Imagem/Build | Domínio público |
|---|---|---|---|
| `postgres` | App (Postgres) | postgres:16-alpine | — (interno) |
| `minio` | App (Compose ou Docker Image) | minio/minio:latest | — (interno) |
| `api` | App (Dockerfile) | Build do repo, `apps/api/Dockerfile` | `api.SEU-DOMINIO.com.br` |
| `dashboard` | App (Dockerfile) | Build do repo, `apps/dashboard/Dockerfile` | `painel.SEU-DOMINIO.com.br` |
| `motorista` | App (Dockerfile) | Build do repo, `apps/motorista/Dockerfile` | `app.SEU-DOMINIO.com.br` |

## 1. Postgres

No Easypanel: **+ Service → Postgres**

- Project: `ronan`
- Service Name: `postgres`
- Postgres Version: `16`
- Username: `ronan_prod`
- Password: gerar uma senha forte (anotar)
- Database: `ronan`

Após criado, anota o internal hostname: `ronan_postgres` (ou similar — Easypanel mostra).

## 2. MinIO

No Easypanel: **+ Service → App** com Docker Image:

- Image: `minio/minio:latest`
- Command: `server /data --console-address ":9001"`
- Environment:
  - `MINIO_ROOT_USER=ronan_minio`
  - `MINIO_ROOT_PASSWORD=` (gerar forte)
- Mounts: `/data` → volume `minio-data`
- Ports: 9000 (interno), 9001 console (publicar como `s3.SEU-DOMINIO.com.br` opcional)

Depois, na primeira vez, criar o bucket via CLI ou via console:
- Login no console em https://s3-console.SEU-DOMINIO.com.br
- Criar bucket `ronan-tickets`
- Anonymous policy: `download`

## 3. API (NestJS)

**+ Service → App** com Source: Git Repository

- Repository: `https://github.com/orlonski/ronan`
- Branch: `main`
- Build Method: **Dockerfile**
- Dockerfile Path: `apps/api/Dockerfile`
- Build Context: `.` (raiz)

### Environment

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://ronan_prod:SENHA@ronan_postgres:5432/ronan?schema=public
JWT_SECRET=GERAR_COM_openssl_rand_hex_32
JWT_REFRESH_SECRET=GERAR_OUTRO_HEX_32
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=90d
MINIO_ENDPOINT=ronan_minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=ronan_minio
MINIO_SECRET_KEY=SENHA_DO_MINIO
MINIO_BUCKET=ronan-tickets
VIACEP_URL=https://viacep.com.br/ws
ANTHROPIC_API_KEY=sk-ant-api03-...
CORS_ORIGINS=https://painel.SEU-DOMINIO.com.br,https://app.SEU-DOMINIO.com.br
PUBLIC_APP_URL=https://app.schaba.com.br
```

> `PUBLIC_APP_URL` é a base pública do painel, usada pra montar o link do
> comprovante compartilhado (`PUBLIC_APP_URL/v/<token>`) que vai pro cliente no
> WhatsApp. Mora na API, e não como `NEXT_PUBLIC_*` no dashboard, porque lá seria
> baked no build da imagem — aqui basta reiniciar. Sem valor, a API loga um
> `warn` no boot e os links saem apontando pra `localhost:3001`.

### Domínio

- `api.SEU-DOMINIO.com.br` → porta interna `3000`
- HTTPS automático (Let's Encrypt do Easypanel)

### Após primeiro deploy

Rodar o seed do admin uma vez (terminal do Easypanel ou Console do container):

```bash
node node_modules/.bin/ts-node -P tsconfig.json --transpile-only src/scripts/seed-admin.ts
```

> _ou copiar `apps/api/src/scripts/seed-admin.ts` em runtime — alternativa é colocar como Job no Easypanel pra rodar uma vez._

## 4. Dashboard (Next.js)

**+ Service → App** com Source: Git Repository

- Repository: `https://github.com/orlonski/ronan`
- Branch: `main`
- Build Method: **Dockerfile**
- Dockerfile Path: `apps/dashboard/Dockerfile`
- Build Context: `.`

### Environment

```
NODE_ENV=production
PORT=3001
NEXTAUTH_URL=https://painel.SEU-DOMINIO.com.br
NEXTAUTH_SECRET=GERAR_HEX_32
NEXT_PUBLIC_API_URL=https://api.SEU-DOMINIO.com.br
```

### Domínio

- `painel.SEU-DOMINIO.com.br` → porta interna `3001`

## 5. Motorista (PWA / Vite + nginx)

**+ Service → App** com Source: Git Repository

- Repository: `https://github.com/orlonski/ronan`
- Branch: `main`
- Build Method: **Dockerfile**
- Dockerfile Path: `apps/motorista/Dockerfile`
- Build Context: `.`
- Build Args:
  - `VITE_API_URL=https://api.SEU-DOMINIO.com.br`

### Environment

(Nenhuma — tudo é embutido em build-time via VITE_API_URL)

### Domínio

- `app.SEU-DOMINIO.com.br` → porta interna `80`

## 6. Configurar PWA pra ser instalável

Pra o app aparecer como "Instalar app" no Chrome do celular do motorista, precisa:

1. HTTPS (já vem com Easypanel)
2. `manifest.webmanifest` (já incluso no build)
3. Service Worker (já incluso via vite-plugin-pwa)

Não precisa fazer nada — funciona sozinho após o deploy.

## 7. Após tudo no ar

### Smoke test
- Acesse `https://painel.SEU-DOMINIO.com.br/login`
- Login: `admin@ronan.local` / `ronan_admin_2026` (ou o que for definido no seed)
- Teste criação de motorista
- Acesse `https://app.SEU-DOMINIO.com.br` no celular
- Login com motorista criado
- Lance uma viagem com foto
- Confirma se sincronizou no painel

### Monitoramento
- Easypanel mostra status, logs e uso de CPU/RAM por container.
- Healthchecks já configurados nos Dockerfiles.

## 8. Backup (opcional, mas recomendado)

A VPS sozinha não faz backup do banco. Pra ativar, ver `scripts/backup-postgres.sh` — script standalone que faz `pg_dump` diário e envia pra Cloudflare R2 (~R$ 5/mês).

Configuração:
1. Criar bucket no Cloudflare R2
2. Criar API token com permissão de write nesse bucket
3. Adicionar variáveis de ambiente no Easypanel:
   - `BACKUP_S3_ENDPOINT=https://CONTA.r2.cloudflarestorage.com`
   - `BACKUP_S3_BUCKET=ronan-backups`
   - `BACKUP_S3_ACCESS_KEY=...`
   - `BACKUP_S3_SECRET_KEY=...`
4. Criar **Cron Job** no Easypanel rodando o script às 3h da manhã.

## 9. Atualizando versões

Cada `git push` na branch `main` dispara rebuild automático no Easypanel (se configurado webhook do GitHub). Caso contrário, clica em "Deploy" no Easypanel.

## 10. Migrations do Prisma

A API roda `prisma migrate deploy` automaticamente no `CMD` do container (ver `apps/api/Dockerfile`). Se uma migration nova for adicionada, basta fazer push e fazer deploy — Prisma aplica antes de subir.

## 11. Troubleshooting comum

### "Cannot connect to database"
- Confere se o `DATABASE_URL` aponta pro hostname interno correto (Easypanel define como `nome_do_servico` ou `nome_do_servico_postgres`).

### Foto não aparece
- Verifica se `MINIO_ENDPOINT` aponta pro hostname interno do MinIO.
- Verifica se o bucket `ronan-tickets` foi criado.
- Verifica policy `anonymous download` ativa.

### Login do dashboard não funciona
- `NEXTAUTH_URL` precisa bater EXATAMENTE com a URL HTTPS pública.
- `NEXT_PUBLIC_API_URL` precisa apontar pra URL HTTPS da api.

### IA não roda
- Conferir `ANTHROPIC_API_KEY` configurada.
- Sem ela, sistema funciona com matching determinístico apenas (já cobre ~70% dos casos).
