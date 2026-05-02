# Testes E2E (Playwright)

Suítes que validam os 2 fluxos críticos do sistema:
1. **`*.motorista.spec.ts`** — PWA do motorista (login, criar viagem, offline)
2. **`*.dashboard.spec.ts`** — Dashboard admin (conciliação, layouts)

## Pré-requisitos

- API rodando em `http://localhost:3000` (`pnpm --filter @ronan/api dev`)
- Dashboard rodando em `http://localhost:3001`
- PWA Motorista rodando em `http://localhost:3002`
- Banco com seed: 1 admin (`admin@ronan.local`) + 1 motorista (`joao.silva`)

## Como rodar

```bash
# Primeira vez: instalar browsers do Playwright
pnpm exec playwright install chromium

# Roda tudo
pnpm exec playwright test

# Só os testes do dashboard
pnpm exec playwright test --project=dashboard

# Só do motorista
pnpm exec playwright test --project=motorista-pwa

# Modo UI interativo
pnpm exec playwright test --ui

# Ver relatório HTML após rodada
pnpm exec playwright show-report
```

## Variáveis de ambiente

```
E2E_ADMIN_EMAIL=admin@ronan.local
E2E_ADMIN_PASS=ronan_admin_2026
E2E_MOTORISTA_USR=joao.silva
E2E_MOTORISTA_PASS=motorista123
```

Default: usa as credenciais acima.

## CI

Pra rodar em CI (GitHub Actions, etc.), o ideal é:
1. Subir docker-compose com api + dashboard + motorista
2. Aguardar healthchecks
3. Rodar `playwright test`

Esqueleto:

```yaml
- run: docker compose up -d --wait
- run: pnpm exec playwright install --with-deps chromium
- run: pnpm exec playwright test
```
