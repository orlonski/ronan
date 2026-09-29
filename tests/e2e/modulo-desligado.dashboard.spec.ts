import { test, expect, type Page } from "@playwright/test";
import { fixarMenuAberto } from "./helpers/menu";

/**
 * Módulo desligado SOME do painel — e sem saber o que a empresa contratou, some
 * também (fail-closed).
 *
 * Contexto: o Ponto é vendido à parte. O painel decide o que desenhar cruzando a
 * PERMISSÃO do papel com o MÓDULO contratado (`usePermissoes().temModulo`). Um
 * papel antigo pode ainda carregar `ponto.*` gravado — e o único freio na tela é
 * o módulo. Até 29/09/2026 `temModulo` devolvia `true` quando a resposta de
 * `/admin/users/me` vinha sem `modulos` ("API antiga durante um deploy"), o que
 * abria o menu inteiro dos módulos vendidos à parte.
 *
 * Como funciona: o teste loga de verdade e reescreve SÓ a resposta de
 * `/admin/users/me` (papel com todas as chaves de ponto + a lista de módulos do
 * cenário). Assim vale contra qualquer seed, sem mexer no banco.
 *
 * Variáveis: E2E_ADMIN_EMAIL / E2E_ADMIN_PASS (README) e, opcional,
 * E2E_DASHBOARD_URL pra apontar outro painel que não o `baseURL` do projeto.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@ronan.local";
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? "ronan_admin_2026";
if (process.env.E2E_DASHBOARD_URL) test.use({ baseURL: process.env.E2E_DASHBOARD_URL });

/** O papel "antigo": tem tudo de ponto (e de outros módulos vendidos) gravado. */
const CHAVES_DE_MODULOS_VENDIDOS = [
  "ponto.ver",
  "funcionarios.ver",
  "funcionarios.criar",
  "jornadas.ver",
  "espelho-ponto.ver",
  "correcoes-ponto.ver",
  "fechamento-ponto.ver",
  "config-ponto.ver",
  "financeiro.ver",
  "acertos.ver",
  "tabelas-preco.ver",
  "fechamentos.ver",
  "cte.ver",
];

type Cenario = { modulos?: string[] | null };

/** Reescreve `/admin/users/me`: papel com as chaves vendidas + os módulos do cenário. */
async function mockMe(page: Page, { modulos }: Cenario) {
  // O passo a passo de boas-vindas abre um modal que cobre o menu.
  await page.route("**/admin/onboarding/tour?*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "null" }),
  );
  await page.route("**/admin/users/me", async (route) => {
    const resp = await route.fetch();
    const me = await resp.json();
    me.permissoes = [...new Set([...(me.permissoes ?? []), ...CHAVES_DE_MODULOS_VENDIDOS])];
    if (modulos === undefined) delete me.modulos;
    else me.modulos = modulos;
    await route.fulfill({ response: resp, json: me });
  });
}

/** Títulos do menu lateral (grupos e itens visíveis). */
async function textoDoMenu(page: Page): Promise<string[]> {
  await page.goto("/");
  // Espera o menu montar de verdade: antes de `/admin/users/me` voltar só há
  // "Dashboard", "Começar" e "Ajustes", e ler nesse instante daria falso
  // "ausente". "Cadastros" é do núcleo — aparece em todo cenário.
  await expect(page.locator("aside").getByText("Cadastros", { exact: true })).toBeVisible();
  // Títulos dos grupos + itens do grupo que já vem aberto ("Dia a dia"). Um
  // módulo desligado tira o GRUPO inteiro quando ele só tem itens do módulo
  // (Registrados, Dinheiro) e o ITEM quando o grupo é misto (Torre, Pedidos).
  return (await page.locator("aside a, aside button").allTextContents()).map((t) => t.trim());
}

test.describe("Painel: módulo desligado some do menu e da URL", () => {
  test.beforeEach(async ({ page }) => {
    // Menu lateral sempre aberto: a Leva 1 recolhe o menu abaixo de 1536px e estes testes leem o `aside`.
    await fixarMenuAberto(page);
    await page.goto("/login");
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  });

  test("só núcleo contratado: Registrados e Dinheiro somem, /ponto diz que não está ativo", async ({ page }) => {
    await mockMe(page, { modulos: ["operacao"] });
    const menu = await textoDoMenu(page);
    expect(menu).not.toContain("Registrados");
    expect(menu).not.toContain("Dinheiro");
    for (const t of ["Torre de controle", "Programação do dia", "Pedidos do cliente"]) expect(menu).not.toContain(t);

    await page.goto("/ponto");
    await expect(page.getByText(/Ponto eletrônico não está ativo na sua empresa/)).toBeVisible();
    await page.goto("/ponto/competencia");
    await expect(page.getByText(/Ponto eletrônico não está ativo na sua empresa/)).toBeVisible();
  });

  test("resposta SEM `modulos` (API antiga / deploy no meio): fail-closed, nada de módulo vendido", async ({ page }) => {
    await mockMe(page, { modulos: undefined });
    const menu = await textoDoMenu(page);
    expect(menu).not.toContain("Registrados");
    expect(menu).not.toContain("Dinheiro");
    for (const t of ["Torre de controle", "Programação do dia", "Pedidos do cliente"]) expect(menu).not.toContain(t);

    await page.goto("/ponto");
    // Não mente dizendo "não contratou": pede pra recarregar.
    await expect(page.getByText(/Não consegui confirmar o que a sua empresa contratou/)).toBeVisible();
    await expect(page.getByText(/Ponto do dia|Quem bateu ponto hoje/)).toHaveCount(0);
  });

  test("`modulos` vazio: também não libera módulo vendido", async ({ page }) => {
    await mockMe(page, { modulos: [] });
    const menu = await textoDoMenu(page);
    expect(menu).not.toContain("Registrados");
    expect(menu).not.toContain("Dinheiro");
  });

  test("com o módulo ponto contratado, quem paga continua vendo (não retira acesso)", async ({ page }) => {
    await mockMe(page, { modulos: ["operacao", "ponto"] });
    const menu = await textoDoMenu(page);
    expect(menu).toContain("Registrados");
    await page.locator("aside button", { hasText: "Registrados" }).click();
    await expect(page.locator("aside").getByText("Ponto do dia")).toBeVisible();
    // ...e o que não foi contratado continua fora.
    expect(menu).not.toContain("Dinheiro");
  });

  test("home não mostra cartão de módulo não contratado", async ({ page }) => {
    await mockMe(page, { modulos: ["operacao"] });
    // Sem isto a conta nova cai na "chegada" e os cartões nem são desenhados.
    await page.route("**/admin/primeiros-passos*", async (route) => {
      const resp = await route.fetch();
      const j = await resp.json();
      await route.fulfill({ response: resp, json: { ...j, concluido: true, chegadaDispensada: true } });
    });
    await page.goto("/");
    await expect(page.getByText(/Precisa de atenção/i)).toBeVisible();
    await expect(page.getByText(/Viagens divergentes/i)).toBeVisible(); // núcleo continua
    await expect(page.getByText(/Fechamentos em revisão/i)).toHaveCount(0);
    await expect(page.getByText(/Envios prontos/i)).toHaveCount(0);
    await expect(page.getByText(/Erros pendentes/i)).toHaveCount(0);
    await expect(page.getByText(/^Faturamento$/i)).toHaveCount(0);
  });
});
