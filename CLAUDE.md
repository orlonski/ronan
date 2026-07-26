# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Ronan — Sistema de viagens da Schaba

Monorepo pnpm + turbo. Sistema de lançamento de viagens, pedágios e abastecimentos pra transportadora. Código, comentários, UI e commits em **PT-BR**.

## Estrutura

```
apps/api/             Backend Nest.js 10 + Prisma 6 + Postgres (porta 3000, Swagger em /docs)
apps/dashboard/       Painel admin Next.js 15 App Router (porta 3001, deploy: app.schaba.com.br)
apps/motorista-app/   App nativo Expo 54/RN — Android + iOS (deploy: EAS Update OTA)
apps/motorista/       PWA Vite/React — motoristas iPhone (porta 3002, motorista.schaba.com.br)
packages/shared-types Schemas Zod + tipos compartilhados por tudo
tests/e2e/            Playwright (dashboard + PWA motorista)
```

## Comandos

```bash
pnpm dev                     # turbo run dev (todos)
pnpm build                   # turbo run build
pnpm typecheck               # turbo run typecheck
pnpm lint                    # turbo run lint
pnpm --filter @ronan/api dev            # só API, :3000
pnpm --filter @ronan/dashboard dev      # só painel, :3001
pnpm --filter @ronan/motorista dev      # só PWA, :3002
pnpm --filter @ronan/shared-types build # rebuild ao mexer em schemas (OBRIGATÓRIO — os apps consomem dist/)

docker compose up -d postgres           # Postgres em localhost:5435 (o apps/api/.env já aponta)
pnpm db:migrate                          # prisma migrate dev
pnpm db:studio
pnpm --filter @ronan/api exec prisma migrate deploy   # aplicar migrations sem gerar nova
```

### Testes

Não existe suíte de unidade rodando (`apps/api` tem vitest configurado mas sem arquivos de teste). A cobertura real é **Playwright E2E**, que exige api+dashboard+PWA de pé e banco semeado — ver `tests/e2e/README.md`.

```bash
pnpm exec playwright install chromium          # 1ª vez
pnpm exec playwright test                      # tudo
pnpm exec playwright test --project=dashboard  # só painel
pnpm exec playwright test --project=motorista-pwa
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

### Guards do motorista (fácil de errar)

`AcessoMotoristaGuard` **só checa alguma coisa se houver `@AcessoMotorista("podeXyz")`** no handler; sem o decorator ele deixa passar direto — inclusive motorista com cadastro ainda não aprovado. Hoje a checagem de `status === "APROVADO"` mora **dentro** desse guard, ou seja, endpoint do motorista sem flag não valida aprovação; ao criar um, checar o status explicitamente. Flags disponíveis em `auth/guards/acesso-motorista.guard.ts` (`podeLancarViagem`, `podeIniciarViagem`, `podeViagemLifecycle`, `podeUsarOcrTicket`, `podeVerStories`, …) — são colunas do `Motorista`, ligadas por motorista no painel (rollout gradual).

### Validação

Corpo das rotas usa **Zod dos `shared-types`** via `ZodValidationPipe` (não class-validator, apesar do `ValidationPipe` global). Erro 400 devolve `{ issues: [...] }`, que os apps do motorista humanizam (`lib/validation.ts`).

### Regras de negócio centralizadas (usar sempre, não reimplementar)

- `common/viagem-status.ts` — `STATUS_FORA_FECHAMENTO` (`EM_ANDAMENTO`, `AGUARDANDO_PESO`): viagens incompletas que nunca entram em match/fechamento/KPI/export. Esquecer um ponto de exclusão faz viagem sem peso entrar como 0t.
- `common/viagem-minimos.ts` — `RegraMinimo` (empresa+material+faixa de km → km/ton mínimo faturado). O real nunca é sobrescrito no banco; o mínimo é aplicado ao **exibir/agregar/faturar**. Todo cálculo de efetivo passa por aqui.
- `common/timezone.ts` — container roda em UTC; "hoje"/mês devem ancorar em `America/Sao_Paulo`, nunca `setHours(0)`.

### Serviços externos

OSRM (`OSRM_URL`, rotas/km) · Valhalla (`VALHALLA_URL`, navegação ao vivo) · MinIO (fotos/tickets) · Evolution API (WhatsApp) · Anthropic/Gemini/OpenAI (`ia/`, OCR de ticket e transcrição) · ViaCEP + Google Maps (geocoding/imagem de local). Chaves via `ConfigService`; só JWT e MinIO são `getOrThrow` — o resto degrada quando ausente.

### Prisma

~55 models em `apps/api/prisma/schema.prisma`. Gotchas recorrentes:
- `$queryRaw` usa o nome do `@@map` (`"viagens"`, `"users"`), não o do model; colunas da Viagem são camelCase. Typecheck não pega, quebra em runtime.
- Função SQL chamada dentro de outra usada em `CREATE INDEX` precisa de `public.` explícito (42883 no inlining). Prod é PG17: `unaccent(text)` single-arg.
- Depois de criar migration, conferir com `git show --stat` se o `migration.sql` entrou — pasta vazia o git ignora em silêncio.
- FK inválida em endpoint do motorista deve virar **4xx**, nunca 500: 500 trava o outbox em loop, 4xx manda o item pra tela de Pendentes.

## Duas bases de código pro motorista (importante)

`apps/motorista-app/` (nativo, Android+iOS) e `apps/motorista/` (PWA iOS) são **codebases separadas** com paridade visual e funcional. Compartilham:
- Backend (`/m/*`)
- `@ronan/shared-types` (schemas Zod, tipos `Viagem`/`Pedagio`/`ExtrairTicketResult`, helpers `cpfDigits`/`formatCpf`/etc)

**Não** compartilham telas, componentes UI nem libs do client. O nativo é o app de ponta (features novas nascem lá); o PWA fica atrás em várias features (stories, lifecycle, navegação) — verificar antes de assumir paridade.

### Regra ao desenvolver features pra motorista

| Mudança | Onde tocar |
|---|---|
| Novo endpoint, novo campo em entidade | Backend + shared-types → ambos os apps pegam após `pnpm build` no shared-types e rebuild |
| Lógica de validação Zod | shared-types → ambos pegam |
| Nova tela / botão / fluxo de UX | **Ambos**: `apps/motorista-app/` E `apps/motorista/` (salvo feature declarada só-nativo) |
| Bug visual / interação no Android/iOS nativo | Só `apps/motorista-app/` |
| Bug visual / interação no PWA iOS | Só `apps/motorista/` |

### Offline-first é o coração dos apps do motorista

Motorista dirige com 4G ruim; **nada pode depender de estar online**.

- **Cache-first**, não network-first: devolve cache na hora e revalida em background (`lib/queries.ts`; timeouts em `lib/api.ts` — 8s request, 30s outbox, 45s upload). Catálogos vêm de `/m/catalogos` e são pré-baixados no login (`prefetchDadosBase`).
- **Outbox**: toda escrita (viagem, pedágio, abastecimento, foto, evento de lifecycle, local, story) é enfileirada com `clientId` e drenada por `lib/sync.ts`. Nativo persiste em AsyncStorage (`db/database.ts`), PWA em Dexie (`src/db/dexie.ts`).
- Falha **transitória** (rede, timeout, 5xx, keychain travado) não consome `attempts` nem vira `FALHOU` — o item segue "Pendente". Só 4xx real exige o motorista editar.
- Item `syncing` precisa de stale-recovery (~5 min), senão processo morto no meio do envio trava o item pra sempre.
- A tela de Pendentes precisa listar **todos** os tipos; tipo faltando some da tela mas continua contando em "X com erro" e fica preso.
- Renomear campo em app offline-first exige **compat layer on-read** do cache, não só na escrita.

### Padrão de port nativo → PWA

- `View` → `div`; `Text` → `<p>`/`<span>`/`<h*>`; `Pressable` → `<button>`/`<Link>`
- `FlatList` → `.map()` ou `IntersectionObserver` pra infinite scroll
- `SafeAreaView` → CSS `env(safe-area-inset-*)` (utilities `pt-safe`, `pb-safe`)
- `expo-router` → `react-router-dom` (`useNavigate`, `<Navigate>`)
- `expo-camera` → `<input type="file" capture="environment">` + `lib/photo.ts` (Canvas compress)
- `expo-location` → `navigator.geolocation` em `lib/geo.ts`
- `expo-haptics` → `navigator.vibrate()` (opcional)
- `lucide-react-native` → `lucide-react`
- `react-native-maps` → Leaflet lazy em `components/map-trajeto.tsx`
- `expo-notifications` → Web Push API em `lib/notifications.ts`
- `SecureStore` → `localStorage`; `AsyncStorage` → Dexie/IndexedDB
- `NetInfo` → `navigator.onLine` + eventos `online`/`offline`
- `AppState` → `visibilitychange` + `pageshow`

Lógica de outbox, sync, queries, validation, datetime são quase 100% portáveis trocando só as APIs nativas.

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

## UI — padrão de botões (semáforo)

Vale pros dois apps e pro painel: verde=confirmar/certo, amarelo=cuidado, vermelho=destrutivo, contorno=cancelar/voltar, laranja (motorista)/azul (painel)=ação de rotina. Rótulo é sempre o verbo do que acontece, nunca "Sim/OK". Guia completo em `docs/padrao-botoes.md`.

Tom dos textos: motoristas são **parceiros autônomos**, não funcionários — evitar "empresa/frota/controle" e linguagem de subordinação.

## Deploy

Easypanel (Contabo, slug `2azr6q`) — push na `main` dispara build de api + dashboard + PWA:
- `ronan-api` — `ronan-api.2azr6q.easypanel.host` (alias `api.schaba.com.br`)
- `ronan-dashboard` — `app.schaba.com.br`
- `ronan-motorista` — `motorista.schaba.com.br`

App nativo: **EAS Update OTA** (canal `production`), fora do Easypanel. OTA não muda a versão nativa.

Sempre commitar `pnpm-lock.yaml` — o build usa `--frozen-lockfile`. Detalhes de infra em `DEPLOY.md`.

### Env vars críticos

| App | Var | Valor prod |
|---|---|---|
| dashboard | `NEXT_PUBLIC_API_URL` / `API_URL` | `https://ronan-api.2azr6q.easypanel.host` |
| motorista (PWA) | `VITE_API_URL` | mesma URL, com **https** e **host público** (nunca `ronan-api:3000` interno do Docker) |
| motorista (PWA) | `VITE_VAPID_PUBLIC_KEY` | (a configurar quando ligar Web Push) |
| api | `CORS_ORIGINS` | CSV de origins — atualmente `*` |

No app nativo, `EXPO_PUBLIC_API_URL` **não** é setado no EAS (usa fallback do código). Já houve OTA publicado com URL de teste vazada pelo cache do Metro — conferir a URL dentro do bundle antes e depois de publicar.

## Fluxo de demandas (ClickUp)
Quando eu passar um ID de task:
1. Buscar a task no ClickUp e ler descrição + comentários
2. Mapear os arquivos afetados antes de codar
3. Implementar
4. Comentar na task: o que foi alterado, arquivos tocados e como testar
Nunca mudar status da task sem eu pedir.