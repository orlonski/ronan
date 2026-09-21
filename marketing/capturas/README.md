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

**Não há caminho automatizado hoje.** O painel captura do build de produção; o app
não — ele precisa de sessão, de dados e de um servidor respondendo.

Até 18/09/2026 a saída era dirigir o PWA (`apps/motorista`) com o Playwright
interceptando todo o `/m/*`. **O PWA foi removido do repositório** e o script
`capturar-tela-app.mjs` foi junto: ele apontava pra `localhost:3002`, que não existe
mais.

O app do motorista hoje é só nativo (React Native), e Playwright não dirige RN. Pra
print novo de tela do motorista, as opções são o Simulador iOS ou um aparelho de
verdade — em ambos os casos, à mão.

Consequência pro Instagram: **peça que precise de tela do motorista exige print
manual.** As capturas que existem aqui são todas do painel.

**E há dívida.** Seis posts já escritos — a 01, 03, 04, 05, 11 e 13 — apontam pra
`assets/telas/2N-app-*.webp`, que são capturas **do PWA**, tiradas pelo script que
morreu junto com ele. São posts que promovem o app nativo mostrando um produto que
não existe mais. Outros oito apontam pra `assets/telas/*.webp` do painel, que estão
velhos e com a badge do Next devtools, quando existe equivalente limpo aqui. Nenhum
deles foi publicado ainda, então dá tempo — mas nenhum deve ir pro ar como está.

Os posts 08 e 15 mostram o jeito certo: print manual do nativo, em resolução de
iPhone de verdade, guardado em `assets/`.

O `ig-qa` bloqueia isso desde 21/09/2026 — print tem que mostrar o que o produto faz
de verdade, tirado à mão ou não.

Um detalhe que sobrevive à mudança, porque é da ARTE e não da captura:

- **`object-position: top`**: a peça mostra o TOPO do print. Enquadre o que você quer
  mostrar no terço de cima, senão fica fora do recorte da moldura `.celular.recorte`,
  que é 1:2,05.
