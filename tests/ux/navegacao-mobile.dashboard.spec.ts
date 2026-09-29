import type { Page } from "@playwright/test";
import { test, expect, abrirRota, entrarComo } from "./ambiente";
import { ROTAS } from "./rotas";

/**
 * Navegação do celular como app (Leva 1, fatia 2): barra inferior + folha "Mais" + cabeçalho com Voltar.
 * Só roda no projeto `mobile` (390x844). O desktop tem o seu próprio teste: a sidebar é lida aqui só
 * pra provar que o menu do celular mostra EXATAMENTE as mesmas telas.
 */
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "mobile", "só faz sentido no celular");
});

const rota = (id: string) => ROTAS.find((r) => r.id === id)!;

/** Abre a rota e, se o passo a passo da home abriu por cima (a suíte não grava "visto"), pula. */
async function abrir(page: Page, id: string): Promise<void> {
  await abrirRota(page, rota(id));
  const pular = page.getByRole("button", { name: "Pular" });
  if (await pular.count()) await pular.click();
  await expect(page.getByRole("dialog", { name: "Passo a passo" })).toHaveCount(0);
}
const barra = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

async function hrefsDaFolha(page: Page): Promise<string[]> {
  await barra(page).getByRole("button", { name: "Mais" }).click();
  const folha = page.getByRole("dialog");
  await expect(folha).toBeVisible();
  const hrefs = await folha.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  await page.keyboard.press("Escape");
  await expect(folha).toBeHidden();
  return hrefs;
}

/** Abre a mesma rota em tela de MacBook e junta os links de todos os grupos da sidebar (accordion: um por vez). */
async function hrefsDaSidebar(page: Page): Promise<string[]> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const aside = page.locator("aside");
  await expect(aside).toBeVisible();
  const juntos = new Set<string>();
  const coletar = async () => {
    for (const h of await aside.locator("nav a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) juntos.add(h);
  };
  await coletar();
  const grupos = aside.locator("nav button[data-coach^='grupo-']");
  const n = await grupos.count();
  for (let i = 0; i < n; i++) {
    await grupos.nth(i).click();
    await coletar();
  }
  return [...juntos];
}

for (const quem of ["admin", "operador"] as const) {
  test(`folha "Mais" == sidebar (mesmas telas) — ${quem}`, async ({ page }) => {
    await entrarComo(page, quem);
    await abrir(page, "home");
    const folha = await hrefsDaFolha(page);
    const sidebar = await hrefsDaSidebar(page);
    expect(folha.length).toBeGreaterThan(3);
    expect(new Set(folha)).toEqual(new Set(sidebar));
    if (quem === "operador") {
      // papel restrito: bem menos telas que o administrador, e nada do que ele não pode ver
      expect(folha).not.toContain("/financeiro");
      expect(folha).not.toContain("/usuarios");
    }
  });
}

test("sem gaveta lateral: nenhuma coluna de menu e nenhum botão de hambúrguer", async ({ page }) => {
  await abrir(page, "home");
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.getByRole("button", { name: "Abrir menu" })).toHaveCount(0);
});

test("barra inferior: administrador vê Início, Viagens, Ao vivo, Motoristas e Mais", async ({ page }) => {
  await entrarComo(page, "admin");
  await abrir(page, "home");
  const nav = barra(page);
  await expect(nav).toBeVisible();
  expect(await nav.locator("a").allInnerTexts()).toEqual(["Início", "Viagens", "Ao vivo", "Motoristas"]);
  await expect(nav.getByRole("button", { name: "Mais" })).toBeVisible();
  // alvo de toque de app: 56px de altura
  expect((await nav.boundingBox())!.height).toBeGreaterThanOrEqual(56);
});

test("barra inferior: quem não vê 'Ao vivo' ganha o próximo destino (papel restrito)", async ({ page }) => {
  await entrarComo(page, "operador");
  await abrir(page, "home");
  expect(await barra(page).locator("a").allInnerTexts()).toEqual(["Início", "Viagens", "Motoristas", "Veículos"]);
});

test("busca de tela: sem acento, por nome de tela e por nome de grupo", async ({ page }) => {
  await entrarComo(page, "admin");
  await abrir(page, "home");
  await barra(page).getByRole("button", { name: "Mais" }).click();
  const folha = page.getByRole("dialog");
  const busca = folha.getByPlaceholder("Buscar tela");
  await busca.fill("veiculos");
  expect(await folha.locator("a[href]").allInnerTexts()).toEqual(["Veículos"]);
  await busca.fill("LANCAMENTOS"); // nome do grupo (Lançamentos) traz o grupo inteiro
  expect((await folha.locator("a[href]").allInnerTexts()).join("|")).toContain("Viagens");
  await busca.fill("zzzzz");
  await expect(folha.getByText("Nenhuma tela com esse nome.")).toBeVisible();
});

test("folha: itens de 48px, rolagem interna e cabe na tela", async ({ page }) => {
  await entrarComo(page, "admin");
  await abrir(page, "home");
  await barra(page).getByRole("button", { name: "Mais" }).click();
  const folha = page.getByRole("dialog");
  await expect(folha).toBeVisible();
  await page.waitForTimeout(600); // termina a animação de subida
  const caixa = (await folha.boundingBox())!;
  expect(caixa.y + caixa.height).toBeLessThanOrEqual(844 + 1);
  expect(caixa.height).toBeLessThanOrEqual(844 * 0.9);
  for (const a of await folha.locator("a[href]").all()) {
    const b = (await a.boundingBox())!;
    if (b.y > caixa.y + caixa.height) continue; // abaixo da dobra (rola)
    expect(b.height, await a.innerText()).toBeGreaterThanOrEqual(44);
  }
  const rola = await folha.locator(".overflow-y-auto").evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(rola).toBe(true);
});

test("folha: tocar numa tela navega e fecha a folha", async ({ page }) => {
  await abrir(page, "home");
  await barra(page).getByRole("button", { name: "Mais" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Veículos" }).click();
  await page.waitForURL("**/veiculos");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("página raiz: logo + sino, sem Voltar; a barra está lá", async ({ page }) => {
  await abrir(page, "viagens");
  await expect(page.getByRole("button", { name: "Voltar" })).toHaveCount(0);
  await expect(barra(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Notificações" }).first()).toBeVisible();
});

test("página filha: sem barra inferior, com Voltar de 44px e título; Voltar leva pra lista", async ({ page }) => {
  await abrir(page, "motorista-detalhe");
  await expect(barra(page)).toHaveCount(0);
  const voltar = page.getByRole("button", { name: "Voltar" }).or(page.getByRole("link", { name: "Voltar" })).first();
  await expect(voltar).toBeVisible();
  const b = (await voltar.boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  // Uma seta só: telas com seta própria escondem a delas no celular.
  expect(await page.getByRole("button", { name: "Voltar" }).or(page.getByRole("link", { name: "Voltar" })).filter({ visible: true }).count()).toBe(1);
  await voltar.click();
  await page.waitForURL(/\/motoristas(\?.*)?$/);
});

test("página filha (FormPageHeader): título sobe pro cabeçalho e não repete embaixo", async ({ page }) => {
  await abrir(page, "motorista-editar");
  const cabecalho = page.locator("header").filter({ has: page.getByRole("button", { name: "Notificações" }) }).first();
  await expect(cabecalho).toContainText("Editar");
  // o h1 da tela segue no DOM (leitor de tela) mas não ocupa lugar visível
  const h1 = page.locator("#conteudo h1").first();
  expect((await h1.boundingBox())!.height).toBeLessThanOrEqual(2);
});

test("teclado aberto (foco num campo de texto): a barra inferior some e volta ao sair do campo", async ({ page }) => {
  await abrir(page, "motoristas");
  await expect(barra(page)).toBeVisible();
  const campo = page.locator("#conteudo input:not([type=checkbox]):not([type=radio]):not([type=file])").first();
  await campo.focus();
  await expect(barra(page)).toHaveCount(0);
  await campo.blur();
  await expect(barra(page)).toBeVisible();
});

test("o menu do celular não muda o que o painel guarda: tour continua achando âncora (Mais)", async ({ page }) => {
  await abrir(page, "home");
  const ancoras = await barra(page).getByRole("button", { name: "Mais" }).getAttribute("data-coach");
  for (const chave of ["comecar", "grupo-lancamentos", "grupo-dia-a-dia"]) expect(ancoras).toContain(chave);
});

test("girar pra paisagem (>= 768px) troca pro layout de tela grande, sem folha nem barra", async ({ page }) => {
  await abrir(page, "home");
  await barra(page).getByRole("button", { name: "Mais" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("dialog")).toBeHidden(); // a folha fecha sozinha (o Radix travaria o clique no resto)
  await expect(page.locator("aside")).toBeVisible();
  await expect(barra(page)).toBeHidden();
});
