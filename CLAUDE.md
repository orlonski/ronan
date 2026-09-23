# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Ronan — Movatruck, sistema de viagens pra transportadoras

Monorepo pnpm + turbo. Sistema de lançamento de viagens, pedágios e abastecimentos pra transportadora. Código, comentários, UI e commits em **PT-BR**.

`ronan` é o nome do repositório; **Movatruck** é o nome do produto. A Schaba era o
sistema inteiro e hoje é o primeiro cliente entre outros — quando "Schaba" aparecer
num texto que o usuário lê, quase sempre é bug de multi-tenant: o certo é sair o
nome da conta. Ficam com o nome antigo, e não dá pra trocar: o bundle ID
`br.com.schaba.motorista` (a Play não permite), o projeto Firebase e os domínios
`*.schaba.com.br`.

## Estrutura

```
apps/api/             Backend Nest.js 10 + Prisma 6 + Postgres (porta 3000, Swagger em /docs)
apps/dashboard/       Painel admin Next.js 15 App Router (porta 3001, deploy: app.schaba.com.br)
apps/motorista-app/   App nativo Expo 54/RN — Android + iOS (deploy: EAS Update OTA)
apps/site/            Site institucional Vite/React estático (porta 3003, www.movatruck.com.br)
packages/shared-types Schemas Zod + tipos compartilhados por tudo
tests/e2e/            Playwright (dashboard)
```

## Comandos

```bash
pnpm dev                     # turbo run dev (todos)
pnpm build                   # turbo run build
pnpm typecheck               # turbo run typecheck
pnpm lint                    # turbo run lint
pnpm --filter @ronan/api dev            # só API, :3000
pnpm --filter @ronan/dashboard dev      # só painel, :3001
pnpm --filter @ronan/site dev           # só site institucional, :3003
pnpm --filter @ronan/shared-types build # rebuild ao mexer em schemas (OBRIGATÓRIO — os apps consomem dist/)

docker compose up -d postgres           # Postgres em localhost:5435 (o apps/api/.env já aponta)
pnpm db:migrate                          # prisma migrate dev
pnpm db:studio
pnpm --filter @ronan/api exec prisma migrate deploy   # aplicar migrations sem gerar nova
```

### Testes

`apps/api` tem **vitest** com ~780 testes de unidade (regras puras e o runner do ClickUp): `cd apps/api && pnpm exec vitest run`. A cobertura de fluxo é **Playwright E2E**, que exige api+dashboard de pé e banco semeado — ver `tests/e2e/README.md`.

`pnpm lint` **não roda**: nenhum app tem `eslint.config.js` (ESLint 9 exige o formato novo e a migração nunca foi feita). Falha em todos os pacotes, é anterior a qualquer mudança — não confundir com regressão.

```bash
pnpm exec playwright install chromium          # 1ª vez
pnpm exec playwright test                      # tudo
pnpm exec playwright test --project=dashboard  # só painel
pnpm exec playwright test tests/e2e/admin-conciliacao.dashboard.spec.ts   # um arquivo
pnpm exec playwright test -g "nome do teste"                              # um teste
```

### App nativo (motorista-app)

```bash
pnpm --filter @ronan/motorista-app start            # Expo dev server
pnpm --filter @ronan/motorista-app ota              # eas update --branch production + avisa motoristas
pnpm --filter @ronan/motorista-app build:android    # build EAS local
```

`eas update` publica a **árvore de trabalho**, não o commit — nunca stashar WIP antes de publicar. Mudança em módulo nativo (ex.: `expo-speech`) **não** vai por OTA, precisa build novo.

## Rodar local — armadilhas

- **`apps/dashboard/.env` aponta pra PRODUÇÃO.** Subir sem sobrescrever = a tela local fala com o banco de produção. Sempre: `NEXT_PUBLIC_API_URL=http://localhost:3000 NEXTAUTH_URL=http://localhost:3001 pnpm --filter @ronan/dashboard dev`.
- Login admin é `POST /admin/auth/login` (`{email, senha}`), motorista é `POST /m/auth/login`. Access token dura 15 min.
- Sem `OSRM_URL` no `.env`, todo cálculo de rota devolve "Servidor de rotas não configurado" e km/pedágio degradam.
- `KmReprocessamentoService` roda de cron e reescreve o `km` de viagens — se o km mudar sozinho no meio de um teste, é ele.
- Não existe `prisma/seed`; ver a skill `verify` (`.claude/skills/verify/`) pra receita de seed, sessão next-auth forjada e screenshot de tela autenticada.

## Arquitetura da API

**Dois públicos, dois prefixos de rota, dois tipos de identidade no JWT** (`kind: "ADMIN_USER" | "MOTORISTA"`, ver `auth/types.ts`):

- `admin/*` — painel. `@Roles("ADMIN_USER")` + `RolesGuard`, mais RBAC granular via `@RequerPermissao("recurso.acao")` + `PermissaoGuard`.
- `m/*` — apps do motorista. `@Roles("MOTORISTA")` + feature flag por motorista.
- `health`, `geocoding`, `errors`, `app/deploy` — utilitários.
- `admin/demandas` — demandas pro agente criadas pelo painel (tela `/demandas`). É a porta de entrada padrão; grava na mesma fila do webhook.
- `clickup/task-ready` — webhook equivalente pra ferramenta externa. Autentica por segredo compartilhado, não por JWT — ver `docs/clickup-runner.md`.

O código do `apps/api` roda em **dois processos**: `dist/main.js` (a API) e `dist/agente-main.js` (o serviço `ronan_agente`, que consome a fila de execuções e não sobe HTTP; imagem em `apps/agente/Dockerfile`). A API só enfileira.

**`JwtAuthGuard` é global (`APP_GUARD` no `AuthModule`)**: rota nova sem `@Public()` responde 401 antes de qualquer guard próprio. Endpoint que se autentica de outro jeito (webhook com segredo) precisa de `@Public()` + guard próprio.

### Guards do motorista (fácil de errar)

`AcessoMotoristaGuard` **só checa alguma coisa se houver `@AcessoMotorista("podeXyz")`** no handler; sem o decorator ele deixa passar direto — inclusive motorista com cadastro ainda não aprovado. Hoje a checagem de `status === "APROVADO"` mora **dentro** desse guard, ou seja, endpoint do motorista sem flag não valida aprovação; ao criar um, checar o status explicitamente. Flags disponíveis em `auth/guards/acesso-motorista.guard.ts` (`podeLancarViagem`, `podeIniciarViagem`, `podeViagemLifecycle`, `podeUsarOcrTicket`, `podeVerStories`, …) — são colunas do `Motorista`, ligadas por motorista no painel (rollout gradual).

### Validação

Corpo das rotas usa **Zod dos `shared-types`** via `ZodValidationPipe` (não class-validator, apesar do `ValidationPipe` global). Erro 400 devolve `{ issues: [...] }`, que os apps do motorista humanizam (`lib/validation.ts`).

### Regras de negócio centralizadas (usar sempre, não reimplementar)

- `common/viagem-status.ts` — `STATUS_FORA_FECHAMENTO` (`EM_ANDAMENTO`, `AGUARDANDO_PESO`): viagens incompletas que nunca entram em match/fechamento/KPI/export. Esquecer um ponto de exclusão faz viagem sem peso entrar como 0t.
- `common/viagem-minimos.ts` — `RegraMinimo` (empresa+material+faixa de km → km/ton mínimo faturado). O real nunca é sobrescrito no banco; o mínimo é aplicado ao **exibir/agregar/faturar**. Todo cálculo de efetivo passa por aqui.
- `common/viagem-preco.ts` — `TabelaPreco` (empresa+material+modo+faixa de km+vigência → R$). **O mínimo decide quanto se CONTA; o preço decide quanto vale o que foi contado** — nessa ordem, sempre: o preço multiplica a quantidade efetiva, nunca a real. A resolução de "qual linha casa" é idêntica à do mínimo de propósito (mesma faixa, mesmo desempate); divergir faria o mínimo valer pra uma faixa e o preço pra outra. O valor vai pra `ViagemValor`, **materializado** (dinheiro se soma: faturamento é `SUM` de milhares de linhas) e **congelado** (guarda preço e quantidade do momento, não FK viva). Quem mantém em dia é `admin/tabelas-preco/precificacao.service.ts`: os caminhos principais chamam na hora, e um cron de madrugada varre o que ficou sem valor — ele **nunca** reprecifica o que já tem. Valor alterado à mão exige motivo e não é sobrescrito por recálculo.
- `common/acerto-motorista.ts` — o que a empresa deve ao motorista no período. A régua de pagamento mora na `ModalidadeMotorista` (percentual/viagem/tonelada/km) e o motorista pode ter a dele, que vence — o override é **tudo-ou-nada**, não campo a campo. **Armadilha do pedágio em dobro:** `Viagem.valorPedagioTotal` (nativo) e `Pedagio.valor` (linhas antigas do PWA, que segue no banco) são fontes independentes; `pedagioDaViagem` escolhe UMA por viagem. Comboio nunca vira reembolso. Acerto FECHADO não regenera e PAGO não reabre.
- `common/pedido-saldo.ts` — saldo do pedido (sempre DERIVADO das viagens, nunca contador) e o casamento plano↔viagem real. ⚠️ `ViagemPlanejada` é **entidade separada** da Viagem: um status `PLANEJADA` no `StatusViagem` obrigaria a revisar os 25 pontos de `STATUS_FORA_FECHAMENTO`, e cada um esquecido vira viagem fantasma de 0t na fatura.
- `common/chave-fiscal.ts` — chave de 44 dígitos com DV módulo 11 e checagem de MODELO. Colar a chave da NF-e no campo do CT-e passa por qualquer regex e só o modelo denuncia.
- `common/consumo.ts` — km/l tanque-a-tanque. Só mede entre dois abastecimentos com `tanqueCheio` e odômetro; parciais no meio entram nos litros, não na fronteira. Média da frota é ponderada pelo km.
- `common/km-motorista.ts` — **o km que o motorista informa é lei.** `Viagem.kmMotorista` é cópia intocável do valor dele (só os 3 caminhos do app escrevem); `Viagem.km` é o faturado. Qualquer alteração de km pelo painel passa por `checarAlteracaoKm` → sem motivo escrito é 400, e o que passa vira auditoria `ADMIN_ALTEROU_KM` + carimbo `kmAlterado*` (que também tira a viagem do reprocessamento). Endpoint novo que escreva `km` tem que chamar a regra — nunca reimplementar.
- `common/timezone.ts` — container roda em UTC; "hoje"/mês devem ancorar em `America/Sao_Paulo`, nunca `setHours(0)`.

### Enviar WhatsApp: sempre pelo `EnvioWhatsappService`

Todo envio passa por `whatsapp/envio/envio-whatsapp.service.ts` declarando **qual mensagem é** (a `rota`, catálogo em `shared-types/src/whatsapp-mensagens.ts`). Nunca chamar `EvolutionClientService.enviarTexto` direto — é o que permite escolher provedor por mensagem quando a Meta Cloud API entrar.

- `enviarOuFalhar` lança `503 ENVIO_WHATSAPP_FALHOU` — pra quem não pode dizer que enviou sem ter enviado (códigos, link de comprovante).
- `tentarEnviar` devolve o resultado e nunca lança — pra quem roda em cron/webhook e não pode derrubar o fluxo.
- `disponivel(rota)` no lugar de `evolution.configurado`: checar só o Evolution faz rota apontada pra outro provedor virar no-op silencioso.
- `params` são os valores de template da Meta. Cada um tem que ser **uma linha só** — a Meta recusa parâmetro com `\n`, tab ou 4+ espaços. Usar `achatarParam`.
- `AVISO_GRUPO` nunca sai do Evolution: a Cloud API não posta em grupo. Um número também não pode estar nos dois provedores — registrar na Meta desfaz o pareamento do WhatsApp Web.

O `EvolutionClientService` segue exportado só pro que é exclusivo dele: grupos, QR code, status da instância e download de mídia.

### Serviços externos

OSRM (`OSRM_URL`, rotas/km) · Valhalla (`VALHALLA_URL`, navegação ao vivo) · MinIO (fotos/tickets) · Evolution API (WhatsApp) · Anthropic/Gemini/OpenAI (`ia/`, OCR de ticket e transcrição) · ViaCEP + Google Maps (geocoding/imagem de local). Chaves via `ConfigService`; só JWT e MinIO são `getOrThrow` — o resto degrada quando ausente.

### Prisma

~100 models em `apps/api/prisma/schema.prisma`. Gotchas recorrentes:
- `$queryRaw` usa o nome do `@@map` (`"viagens"`, `"users"`), não o do model; colunas da Viagem são camelCase. Typecheck não pega, quebra em runtime.
- Função SQL chamada dentro de outra usada em `CREATE INDEX` precisa de `public.` explícito (42883 no inlining). Prod é PG17: `unaccent(text)` single-arg.
- Depois de criar migration, conferir com `git show --stat` se o `migration.sql` entrou — pasta vazia o git ignora em silêncio.
- FK inválida em endpoint do motorista deve virar **4xx**, nunca 500: 500 trava o outbox em loop, 4xx manda o item pra tela de Pendentes.

## Uma base de código pro motorista

**`apps/motorista-app/` (nativo, Android+iOS) é o ÚNICO app do motorista.**

O PWA (`apps/motorista/`, Vite/React, `motorista.schaba.com.br`) foi **removido do
repositório em 18/09/2026** e o serviço dele foi desligado. Não existe mais, não vai
voltar, e não há decisão de "mexer nos dois" a tomar: feature de motorista vai pro
nativo, ponto.

Isso importa porque o repositório carregou por meses uma regra de "onde tocar" que
cobrava imposto de decisão em toda feature. Ela morreu junto.

O que sobrou do PWA no sistema, de propósito:

- **`OrigemEvento` em `shared-types` ainda aceita `"motorista-pwa"`.** A telemetria
  que ele gravou está no banco com esse valor; tirar do enum faria o Zod recusar a
  leitura do histórico. É rótulo de dado antigo, não plataforma viva.
- **`Pedagio.valor` continua sendo fonte de pedágio** (ver `common/acerto-motorista.ts`).
  Linhas criadas pelo PWA seguem no banco e ainda entram em acerto — a armadilha do
  pedágio em dobro continua valendo.

Feature de motorista toca: backend (`/m/*`) + `@ronan/shared-types` + `apps/motorista-app/`.

### Offline-first é o coração do app do motorista

Motorista dirige com 4G ruim; **nada pode depender de estar online**.

- **Cache-first**, não network-first: devolve cache na hora e revalida em background (`lib/queries.ts`; timeouts em `lib/api.ts` — 8s request, 30s outbox, 45s upload). Catálogos vêm de `/m/catalogos` e são pré-baixados no login (`prefetchDadosBase`).
- **Outbox**: toda escrita (viagem, pedágio, abastecimento, foto, evento de lifecycle, local, story) é enfileirada com `clientId` e drenada por `lib/sync.ts`. Persiste em AsyncStorage (`db/database.ts`).
- Falha **transitória** (rede, timeout, 5xx, keychain travado) não consome `attempts` nem vira `FALHOU` — o item segue "Pendente". Só 4xx real exige o motorista editar.
- Item `syncing` precisa de stale-recovery (~5 min), senão processo morto no meio do envio trava o item pra sempre.
- A tela de Pendentes precisa listar **todos** os tipos; tipo faltando some da tela mas continua contando em "X com erro" e fica preso.
- Renomear campo em app offline-first exige **compat layer on-read** do cache, não só na escrita.

### Gotchas de React Native já pagos caro

- `SecureStore` default `WHEN_UNLOCKED` quebra leitura do token com a tela travada; usar `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (trocar a classe de um item existente exige DELETE+SET).
- Nunca `await import("react-native")` (namespace dynamic import crasha o iOS) — import estático nomeado.
- Import estático de módulo nativo não é protegido por `Platform.OS`; pod dropado em silêncio = crash de boot.
- `Polyline` com `tappable`/`onPress`/`zIndex` crasha nativo no iOS. Usar Google Maps nas duas plataformas e remontar o mapa (`key={shape}`) pra polilinha aparecer.
- Overlay que mede elemento (coachmark) não pode usar `Modal` no Android (edge-to-edge SDK54 → janela separada desalinha `measureInWindow`). Mesmo motivo faz `showConfirm`/AlertHost abrir **atrás** de um `<Modal>` de tela cheia — usar confirmação inline.
- Teclado no Android (edge-to-edge SDK54) não redimensiona a janela: `KeyboardAvoidingView behavior="padding"` nas duas plataformas + `scrollToEnd`.
- `<Image>` com header de auth só pode montar com o token pronto (`token && <Image>`), senão o Fresco cacheia o 401 e a imagem fica preta.
- Não pedir permissão do SO em listener de `AppState` — vira loop de foco.
- Auth: os apps do motorista só deslogam em 401/403 **do refresh**; rede/5xx é transitório e mantém a sessão.

## Dashboard

Next.js App Router; tudo de painel dentro de `src/app/(painel)/`. Sessão via **next-auth v4** (credentials) guardando o `accessToken` da API no JWT; `lib/api.ts` é o cliente server-side (usa a sessão), `lib/client-api.ts` o client-side. UI = Tailwind + Radix + shadcn-style em `components/ui`.

- FK grande (Locais/Veículos/Motoristas/Clientes) usa `AsyncCombobox` server-side (wrappers em `fk-comboboxes.tsx`), nunca `useResourceOptions` — o teto de 200 escondia registros.
- Telas e botões são gatados por permissão (`temPermissao("recurso.acao")` / `<RequerTela>`), espelhando o catálogo em `shared-types/src/permissoes.ts`. Pra colocar algo novo sob permissão: chave no catálogo → gate na UI → `@RequerPermissao` no endpoint. O seed sincroniza o resto.

### Módulos contratados (o que a empresa comprou)

`ModuloContratado` (tabela, não array — módulo tem data e autor) + catálogo em
`shared-types/src/modulos.ts`. **O módulo é dono de RECURSOS, não de chaves**:
`viagens.arquivar` criada amanhã entra no módulo sozinha.

Entra **por cima** do RBAC, como fator do `tetoDaConta()` — a poda de chave acima
do teto já existia, então módulo cancelado poda papel de graça. Nove testes de
invariante quebram o build se um recurso ficar órfão ou em dois módulos.

O **boot-check** (`common/modulos/modulos.boot-check.ts`) varre os controllers no
boot e **derruba a subida** se um endpoint de `admin/*` não declarar
`@RequerPermissao` (ou `@Public`, ou `PlataformaGuard`). Endpoint novo sem
decorator não passa no CI. A dívida conhecida vive em
`endpoints-sem-permissao.ts`, e essa lista **só encolhe**.

Na UI: item não contratado **some** do menu; quem chega por URL vê uma tela
diferente da de "acesso restrito" — "fale com um administrador" é mentira quando
o administrador não pode resolver.

## UI — padrão de botões (semáforo)

Vale pros dois apps e pro painel: verde=confirmar/certo, amarelo=cuidado, vermelho=destrutivo, contorno=cancelar/voltar, laranja (motorista)/azul (painel)=ação de rotina. Rótulo é sempre o verbo do que acontece, nunca "Sim/OK". Guia completo em `docs/padrao-botoes.md`.

Tom dos textos: motoristas são **parceiros autônomos**, não funcionários — evitar "empresa/frota/controle" e linguagem de subordinação.

## Deploy

Easypanel (Contabo, slug `2azr6q`) — push na `main` dispara build de api + dashboard:
- `ronan-api` — `ronan-api.2azr6q.easypanel.host` (alias `api.schaba.com.br`)
- `ronan-dashboard` — `app.movatruck.com.br` (+ `app.schaba.com.br`, o domínio antigo, ainda apontando pro mesmo painel)
- `ronan-site` — site institucional público, estático em nginx (`apps/site/Dockerfile`)
- `ronan_agente` — worker da fila de execuções (`apps/agente/Dockerfile`, sem domínio público)

App nativo: **EAS Update OTA** (canal `production`), fora do Easypanel. OTA não muda a versão nativa.

Sempre commitar `pnpm-lock.yaml` — o build usa `--frozen-lockfile`. Detalhes de infra em `DEPLOY.md`.

### Env vars críticos

| App | Var | Valor prod |
|---|---|---|
| dashboard | `NEXT_PUBLIC_API_URL` / `API_URL` | `https://ronan-api.2azr6q.easypanel.host` |
| api | `CORS_ORIGINS` | CSV de origins — atualmente `*` |

No app nativo, `EXPO_PUBLIC_API_URL` **não** é setado no EAS (usa fallback do código). Já houve OTA publicado com URL de teste vazada pelo cache do Metro — conferir a URL dentro do bundle antes e depois de publicar.

## Marketing — Instagram (@movatruck)

`marketing/instagram/` é a fábrica de posts: a arte é **HTML renderizado em PNG**
(`node render.mjs`), não arquivo de editor gráfico — mexer no `base.css` refaz as peças
todas. Cinco agentes em `.claude/agents/ig-*.md` cobrem estratégia, copy, direção de
arte, design e QA; a receita completa está na skill `post-instagram`.

O publicador automático (API oficial da Meta, sem navegador) vive em
`apps/api/src/marketing/` e nasce desligado em dois interruptores: credencial em env
e `ConfiguracaoPlataforma.instagramAtivo`. Como ligar: `docs/instagram-publicador.md`.

**Nada vai pro ar sem existir no código.** O `ig-qa` confere cada promessa contra o
repositório — na primeira leva ele barrou cinco peças que pareciam verdade e não eram.
Prints de produto saem do build de produção (`marketing/capturas/`), porque os antigos
em `apps/site/public/telas/` carregam a badge do Next devtools.

## Fluxo de demandas (ClickUp)
Quando eu passar um ID de task:
1. Buscar a task no ClickUp e ler descrição + comentários
2. Mapear os arquivos afetados antes de codar
3. Implementar
4. Comentar na task: o que foi alterado, arquivos tocados e como testar
Nunca mudar status da task sem eu pedir.