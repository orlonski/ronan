---
name: verify
description: Como rodar o Ronan localmente (API + dashboard + Postgres) e dirigir uma tela autenticada de verdade pra verificar uma mudança.
---

# Verificar uma mudança no Ronan

Receita testada verificando o aviso de pedágio no detalhe da viagem.

## Subir o stack

```bash
docker compose up -d postgres              # Postgres em localhost:5435 (o .env do api já aponta)
cd apps/api && pnpm prisma migrate deploy  # idempotente
pnpm --filter @ronan/api dev               # :3000
```

**O `.env` do dashboard aponta pra PRODUÇÃO** (`https://ronan-api.2azr6q.easypanel.host`).
Subir sem sobrescrever = a tela local fala com o banco de produção. Sempre:

```bash
cd apps/dashboard && NEXT_PUBLIC_API_URL=http://localhost:3000 NEXTAUTH_URL=http://localhost:3001 pnpm dev -p 3001
```

## Gotchas que custaram tempo

- **Login admin é `POST /admin/auth/login`** (`{email, senha}` → `{accessToken}`), não `/auth/login`. O token dura **15 min** — renove antes de cada rodada de Playwright ou tudo vira 401.
- **Playwright é `@playwright/test`**, não `playwright` (o import falha).
- **Sem `OSRM_URL` no `.env` local**, todo cálculo de rota devolve "Servidor de rotas não configurado" e os caminhos que dependem de geometria degradam. Pra testar rota/km/pedágio, suba um OSRM falso e passe `OSRM_URL=http://localhost:5555`. Um servidor HTTP de ~30 linhas respondendo `{code:"Ok",routes:[{distance,duration,geometry}]}` basta — e deixa você **controlar** qual variante passa onde: `req.url.includes("approaches=")` distingue a variante COM retorno (curb) da SEM retorno.
- **`KmReprocessamentoService` roda de cron** e reescreve o `km` das viagens semeadas em poucos minutos. Se o km mudar sozinho no meio do teste, é ele — não a sua mudança.
- Polyline é formato Google precision 5. Pra montar geometrias sintéticas, encode inline (o algoritmo cabe em 15 linhas) — mais rápido que achar a lib.

## Tela autenticada (Playwright + sessão forjada)

Rodar **de dentro de `apps/dashboard/`** (resolve o next-auth v4 do repo):

```js
import { encode } from "next-auth/jwt";
import { chromium } from "@playwright/test";
const cookie = await encode({
  token: { name: "Admin", email: "...", sub: "x", accessToken: TOKEN_DO_LOGIN },
  secret: NEXTAUTH_SECRET,  // ler do .env
});
// addCookies({ name: "next-auth.session-token", value: cookie, domain: "localhost", path: "/" })
```

O `(painel)/layout.tsx` só checa se a sessão existe; o `accessToken` de dentro do
token é o que vai nas chamadas à API. Abortar `**/inbox/stream*` (SSE).
Com a API local real de pé **não precisa mockar `/admin/*`** — só mocke quando
não quiser subir o backend (aí o catch-all precisa de `{itens:[],naoLidas:0}`,
senão o sininho crasha).

## Seed

Não existe `prisma/seed`. Escrever um script CJS e rodar **de dentro de `apps/api/`**
(pra resolver `@prisma/client`) com `DATABASE_URL` do docker local.
Ordem de FK: `User → Empresa → Cliente / Material / Veiculo / Motorista → Local → Viagem`.
Obrigatórios que mordem: `Viagem.clientId` (unique), `Local.tipo/logradouro/cidade/uf`,
`Motorista.cpf` (11 dígitos) + `senhaHash`.

## Verificar de verdade

Dirija a **tela**, não só o endpoint: `page.goto("/viagens/<id>")` e leia o texto
renderizado (ex.: `/Sem valor de pedágio, mas rota passa por/`). Screenshot
`fullPage` pra evidência. O endpoint sozinho não prova o que o admin vê.
