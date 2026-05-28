# Ronan — Sistema de viagens da Schaba

Monorepo pnpm + turbo. Sistema de lançamento de viagens, pedágios e abastecimentos pra transportadora.

## Estrutura

```
apps/api/             Backend Nest.js + Prisma + Postgres
apps/dashboard/       Painel admin Next.js 15 (deploy: app.schaba.com.br)
apps/motorista-app/   App nativo Expo/RN — produção Android (motorista.schaba via EAS Update)
apps/motorista/       PWA Vite/React — motoristas iPhone (motorista.schaba.com.br)
packages/shared-types Schemas Zod + tipos compartilhados por tudo
```

## Duas bases de código pro motorista (importante)

`apps/motorista-app/` (Android nativo) e `apps/motorista/` (PWA iOS) são **codebases separadas** com paridade visual e funcional. Compartilham:
- Backend (`/m/*` endpoints)
- `@ronan/shared-types` (schemas Zod, tipos `Viagem`/`Pedagio`/`ExtrairTicketResult`, helpers `cpfDigits`/`formatCpf`/etc)

**Não** compartilham telas, componentes UI nem libs do client.

### Regra ao desenvolver features pra motorista

| Mudança | Onde tocar |
|---|---|
| Novo endpoint, novo campo em entidade | Backend + shared-types → ambos os apps pegam após `pnpm build` no shared-types e rebuild |
| Lógica de validação Zod | shared-types → ambos pegam |
| Nova tela / botão / fluxo de UX | **Ambos**: `apps/motorista-app/` E `apps/motorista/` |
| Bug visual / interação no Android | Só `apps/motorista-app/` |
| Bug visual / interação no PWA iOS | Só `apps/motorista/` |

### Padrão de port nativo → PWA

Quando porta tela do nativo (Expo) pro PWA (web):
- `View` → `div`
- `Text` → `<p>`, `<span>`, `<h*>` (semântico)
- `Pressable` → `<button>` ou `<Link>`
- `FlatList` → `.map()` ou `IntersectionObserver` pra infinite scroll
- `SafeAreaView` → CSS `env(safe-area-inset-*)` (já há utilities `pt-safe`, `pb-safe`)
- `expo-router` → `react-router-dom` (`useNavigate`, `<Navigate>`)
- `expo-camera` → `<input type="file" capture="environment">` + `lib/photo.ts` (Canvas compress)
- `expo-location` → `navigator.geolocation` em `lib/geo.ts`
- `expo-haptics` → `navigator.vibrate()` (opcional)
- `lucide-react-native` → `lucide-react`
- `react-native-maps` → Leaflet lazy em `components/map-trajeto.tsx`
- `expo-notifications` → Web Push API em `lib/notifications.ts`
- `SecureStore` → `localStorage`
- `AsyncStorage` → Dexie/IndexedDB
- `NetInfo` → `navigator.onLine` + eventos `online`/`offline`
- `AppState` → `visibilitychange` + `pageshow`

Lógica de outbox, sync, queries, validation, datetime são quase 100% portáveis trocando só as APIs nativas.

## Deploy

Easypanel (Contabo, slug `2azr6q`):
- `ronan-api` — backend (`ronan-api.2azr6q.easypanel.host`)
- `ronan-dashboard` — admin (`app.schaba.com.br`)
- `ronan-motorista` — PWA (`motorista.schaba.com.br` + `ronan-motorista.2azr6q.easypanel.host`)

Motorista nativo Android: deploy via **EAS Update OTA** (canal `production`), não passa pelo Easypanel.

## Build args / env vars críticos

| App | Var | Valor prod |
|---|---|---|
| dashboard | `NEXT_PUBLIC_API_URL` | `https://ronan-api.2azr6q.easypanel.host` |
| motorista (PWA) | `VITE_API_URL` | `https://ronan-api.2azr6q.easypanel.host` (com **https** e **host público**, nunca `ronan-api:3000` interno Docker) |
| motorista (PWA) | `VITE_VAPID_PUBLIC_KEY` | (a configurar quando ligar Web Push) |
| api | `CORS_ORIGINS` | CSV de origins — atualmente `*` |

## Comandos úteis

```bash
pnpm dev                     # turbo run dev (todos)
pnpm build                   # turbo run build (todos)
pnpm typecheck               # turbo run typecheck
pnpm --filter @ronan/motorista dev      # só PWA, porta 3002
pnpm --filter @ronan/api dev            # só API, porta 3000
pnpm db:migrate                          # prisma migrate dev no API
pnpm --filter @ronan/shared-types build  # rebuild se mexer em schemas (importante)
```
