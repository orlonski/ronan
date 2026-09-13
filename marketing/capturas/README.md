# Capturas de produto

Telas do painel tiradas do **build de produção** (`next build` + standalone), não do
dev server — é o que elimina a badge do Next devtools que aparece nos arquivos
antigos de `apps/site/public/telas/`.

## Como foram feitas

```bash
docker compose up -d postgres minio
pnpm --filter @ronan/api dev                       # :3000

cd apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3000 API_URL=http://localhost:3000 \
  NEXTAUTH_URL=http://localhost:3005 pnpm build
cp -r .next/static .next/standalone/apps/dashboard/.next/static
cp -r public        .next/standalone/apps/dashboard/public
cd .next/standalone/apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3000 NEXTAUTH_URL=http://localhost:3005 \
  NEXTAUTH_SECRET=<do .env> PORT=3005 node server.js
```

**A porta importa.** O `CORS_ORIGINS` do `.env` da API lista 3001/3002/3003/3005 —
em qualquer outra porta o `/admin/users/me` é bloqueado, `usePermissoes` fica sem
dados e toda tela vira "Você não tem acesso". Isso não aparece como erro na tela,
só como tela vazia; custou tempo.

Sessão: cookie `next-auth.session-token` forjado com `encode` do next-auth
(ver a skill `verify`), rodando de dentro de `apps/dashboard/`. O token da API
dura 15 min — renove antes de cada rodada.

## O que ainda não está bom

O `01-painel-home` sai com KPIs magros (1 viagem hoje, ritmo 0,0/dia) porque as
viagens do banco local estão concentradas em poucos dias. Espalhá-las pelos
últimos 21 dias resolveria, mas é um UPDATE em massa — fazer manualmente com a
supervisão de quem é dono do banco.

Faltando: a tela de "Aguardando internet" do app do motorista **com itens na fila**
(hoje só existe captura do estado vazio, que prova o contrário do que o post diz).

## Telas do app do motorista

O painel dá pra capturar do build de produção; o app não — ele precisa de sessão,
de dados e de um servidor respondendo. A saída é o PWA (`apps/motorista`, que tem
paridade visual com o nativo) com **todo o `/m/*` interceptado pelo Playwright**:
nenhuma chamada sai da máquina, e os dados da tela são escolhidos aqui.

```bash
pnpm --filter @ronan/motorista dev        # :3002
node marketing/capturas/capturar-tela-app.mjs
```

O script de referência é o da tela de abastecimento (`assets/app-abastecimento-postos.png`),
e serve de molde pras outras: troque a rota, o mock e o enquadramento.

Três detalhes que custaram tempo:

- **Viewport 390×844.** O descritor `devices["iPhone 13"]` do Playwright usa 390×664,
  que dá 1:1,70 — e a moldura `.celular.recorte` das peças é 1:2,05, então ela cortaria
  a imagem nas laterais. Sobrescrever o viewport devolve o 1:2,16 do aparelho real.
- **A sessão mora em `ronan.motorista.tokens`** (`lib/sessoes.ts`), não em `token`.
  Chave errada = tela de login.
- **`object-position: top`**: a peça mostra o TOPO do print. Role a página até o que
  você quer mostrar ficar no terço de cima, senão ele fica fora do recorte.
