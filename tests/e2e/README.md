# Testes E2E (Playwright)

Suítes que validam os fluxos críticos do **painel**:
- **`*.dashboard.spec.ts`** — Dashboard admin (conciliação, layouts, isolamento de contas)

> Não há E2E do app do motorista. A suíte `*.motorista.spec.ts` dirigia o PWA, que foi
> removido em 18/09/2026; o app hoje é só nativo (React Native) e o Playwright não
> dirige RN. Cobertura de motorista é vitest na API (as regras) + teste no aparelho.

## Pré-requisitos

- API rodando em `http://localhost:3000` (`pnpm --filter @ronan/api dev`)
- Dashboard rodando em `http://localhost:3001`
- Banco com seed: 1 admin (`admin@ronan.local`)

## Como rodar

```bash
# Primeira vez: instalar browsers do Playwright
pnpm exec playwright install chromium

# Roda tudo
pnpm exec playwright test

# Só os testes do dashboard
pnpm exec playwright test --project=dashboard

# Modo UI interativo
pnpm exec playwright test --ui

# Ver relatório HTML após rodada
pnpm exec playwright show-report
```

## Variáveis de ambiente

```
E2E_ADMIN_EMAIL=admin@ronan.local
E2E_ADMIN_PASS=ronan_admin_2026
```

Default: usa as credenciais acima.

## CI

Pra rodar em CI (GitHub Actions, etc.), o ideal é:
1. Subir docker-compose com api + dashboard
2. Aguardar healthchecks
3. Rodar `playwright test`

Esqueleto:

```yaml
- run: docker compose up -d --wait
- run: pnpm exec playwright install --with-deps chromium
- run: pnpm exec playwright test
```
