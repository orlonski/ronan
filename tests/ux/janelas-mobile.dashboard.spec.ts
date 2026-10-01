import type { Page } from "@playwright/test";
import { test, expect, abrirRota, entrarComo } from "./ambiente";

/**
 * Janelas como folha de baixo + banner "Sobre esta tela" (Leva 1, fatia 3).
 * Comportamento no celular (projeto `mobile`) e a prova de que o desktop (mac1440, mac1280, ultra) segue centrado e igual.
 * Só abre e olha: nada é confirmado (e o contexto aborta qualquer escrita).
 */
const ROTA_CPF = { id: "cpf", rotulo: "motoristas", url: "/motoristas" };
const JANELA = '[role="dialog"][data-folha]';

async function abrirConvidar(page: Page) {
  await abrirRota(page, ROTA_CPF);
  const pular = page.getByRole("button", { name: "Pular" });
  if (await pular.count()) await pular.click();
  await page.getByRole("button", { name: "Convidar por CPF" }).click();
  await expect(page.locator(JANELA)).toBeVisible();
  await page.waitForTimeout(600);
}
async function abrirModulos(page: Page) {
  await entrarComo(page, "super");
  await abrirRota(page, { id: "contas", rotulo: "contas", url: "/contas", usuario: "super" });
  const pular = page.getByRole("button", { name: "Pular" });
  if (await pular.count()) await pular.click();
  await page.getByRole("button", { name: "Módulos" }).first().click();
  await expect(page.locator(JANELA)).toBeVisible();
  await page.waitForTimeout(600);
}
const rect = (page: Page) =>
  page.locator(JANELA).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight, raioTopo: parseFloat(cs.borderTopLeftRadius), raioBase: parseFloat(cs.borderBottomLeftRadius) };
  });

test.describe("celular", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "só no celular"));

  test("a janela vira folha: ancorada embaixo, largura total, cantos de cima arredondados, fechar de 44px", async ({ page }) => {
    await abrirConvidar(page);
    const r = await rect(page);
    expect(Math.round(r.bottom)).toBe(r.vh);
    expect(Math.round(r.w)).toBe(r.vw);
    expect(r.raioTopo).toBeGreaterThanOrEqual(12);
    expect(r.raioBase).toBe(0);
    const fechar = await page.locator(`${JANELA} button:has(.sr-only)`).first().boundingBox();
    expect(fechar!.width).toBeGreaterThanOrEqual(44);
    expect(fechar!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator(`${JANELA} [data-alca-folha]`)).toBeVisible();
  });

  test("miolo longo rola por dentro: cabeçalho e rodapé ficam à vista e a folha NÃO fecha ao rolar", async ({ page }) => {
    await abrirModulos(page);
    const antes = await rect(page);
    expect(antes.top).toBeGreaterThan(0); // folga do topo
    expect(antes.h).toBeLessThan(antes.vh);
    const corpo = page.locator(`${JANELA} > div:nth-child(2)`);
    expect(await corpo.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await corpo.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await page.waitForTimeout(300);
    await corpo.evaluate((e) => e.scrollTo(0, 0));
    await corpo.evaluate((e) => e.scrollTo(0, e.scrollHeight / 2));
    await page.waitForTimeout(300);
    await expect(page.locator(JANELA)).toBeVisible();
    const titulo = await page.locator(`${JANELA} h2`).boundingBox();
    const rodape = await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).last().boundingBox();
    expect(titulo!.y).toBeGreaterThanOrEqual(0);
    expect(titulo!.y + titulo!.height).toBeLessThan(antes.top + 120); // cabeçalho colado no topo mesmo rolado
    expect(rodape!.y + rodape!.height).toBeLessThanOrEqual(antes.vh + 1); // rodapé de ações à vista
  });

  test("arrastar a alça pra baixo fecha; arrasto curto volta", async ({ page }) => {
    await abrirConvidar(page);
    const alca = await page.locator(`${JANELA} [data-alca-folha]`).boundingBox();
    const x = alca!.x + alca!.width / 2;
    const y = alca!.y + alca!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 40, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(page.locator(JANELA)).toBeVisible();
    const alca2 = await page.locator(`${JANELA} [data-alca-folha]`).boundingBox();
    await page.mouse.move(alca2!.x + 100, alca2!.y + 8);
    await page.mouse.down();
    await page.mouse.move(alca2!.x + 100, alca2!.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(JANELA)).toBeHidden({ timeout: 3000 });
  });

  test("Escape fecha", async ({ page }) => {
    await abrirConvidar(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(JANELA)).toBeHidden();
  });

  test("teclado estilo Android (a janela encolhe): campo e botão principal continuam à vista", async ({ page }) => {
    await abrirConvidar(page);
    const campo = page.getByPlaceholder("000.000.000-00");
    await campo.focus();
    await page.setViewportSize({ width: 390, height: 520 });
    await page.waitForTimeout(900);
    const r = await rect(page);
    expect(r.bottom).toBeLessThanOrEqual(520 + 1);
    expect(r.top).toBeGreaterThanOrEqual(0);
    const c = await campo.boundingBox();
    const b = await page.getByRole("button", { name: "Enviar convite" }).boundingBox();
    expect(c!.y).toBeGreaterThanOrEqual(0);
    expect(c!.y + c!.height).toBeLessThanOrEqual(520);
    expect(b!.y + b!.height).toBeLessThanOrEqual(520);
  });

  test("teclado estilo iPhone (só a área visível encolhe): a folha sobe pela altura do teclado", async ({ page }) => {
    await abrirConvidar(page);
    const campo = page.getByPlaceholder("000.000.000-00");
    // o Safari NÃO redimensiona a janela: simulamos só o visualViewport (336 = 844 - teclado de 324)
    await page.evaluate(() => {
      const vv = window.visualViewport!;
      Object.defineProperty(vv, "height", { get: () => 520, configurable: true });
      Object.defineProperty(vv, "offsetTop", { get: () => 0, configurable: true });
      vv.dispatchEvent(new Event("resize"));
    });
    await campo.focus();
    await page.waitForTimeout(900);
    const teclado = await page.locator(JANELA).evaluate((e) => (e as HTMLElement).style.getPropertyValue("--folha-teclado"));
    expect(teclado).toBe("324px");
    const r = await rect(page);
    expect(Math.abs(r.bottom - 520)).toBeLessThanOrEqual(2);
    const b = await page.getByRole("button", { name: "Enviar convite" }).boundingBox();
    const c = await campo.boundingBox();
    expect(b!.y + b!.height).toBeLessThanOrEqual(520);
    expect(c!.y).toBeGreaterThanOrEqual(r.top);
    // o teclado fechou: volta ao chão
    await page.evaluate(() => {
      const vv = window.visualViewport!;
      Object.defineProperty(vv, "height", { get: () => window.innerHeight, configurable: true });
      vv.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(300);
    expect(Math.abs((await rect(page)).bottom - 844)).toBeLessThanOrEqual(2); // volta ao chão (folga de subpixel)
  });

  test("confirmação curta (Excluir X?) fica CENTRADA, com margem dos lados", async ({ page }) => {
    await abrirRota(page, ROTA_CPF);
    const pular = page.getByRole("button", { name: "Pular" });
    if (await pular.count()) await pular.click();
    await page.getByRole("button", { name: /Excluir o motorista/ }).first().click();
    const j = page.locator('[role="dialog"][data-folha="centrado"]');
    await expect(j).toBeVisible();
    await page.waitForTimeout(500);
    const r = await j.evaluate((el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: window.innerWidth - b.right, cy: (b.top + b.bottom) / 2, vh: window.innerHeight }; });
    expect(Math.round(r.l)).toBe(16);
    expect(Math.round(r.r)).toBe(16);
    expect(Math.abs(r.cy - r.vh / 2)).toBeLessThan(4);
    await expect(j.locator("[data-alca-folha]")).toHaveCount(0);
  });

  test("girar o aparelho (844x390): passa de 768px e recebe o layout de janela do desktop (documentado, não é o alvo desta fatia)", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await abrirConvidar(page);
    const r = await rect(page);
    expect(r.w).toBeLessThan(r.vw); // não é folha de largura total
    expect(Math.abs((r.left + r.right) / 2 - r.vw / 2)).toBeLessThan(2); // centrada
    await expect(page.locator(`${JANELA} [data-alca-folha]`)).toBeHidden();
  });

  test("o passo a passo (tour) continua por cima e funciona; a folha abre depois de pular", async ({ page }) => {
    await abrirRota(page, { id: "home", rotulo: "home", url: "/" });
    const tour = page.getByRole("dialog", { name: "Passo a passo" });
    await expect(tour).toBeVisible({ timeout: 8000 }); // a suíte nunca grava "visto": a home sempre abre com o tour
    const z = await tour.evaluate((e) => getComputedStyle(e).zIndex);
    expect(Number(z)).toBeGreaterThan(50); // por cima de qualquer janela (z-50)
    await page.getByRole("button", { name: "Pular" }).click();
    await expect(tour).toHaveCount(0);
    await page.goto("/motoristas");
    await page.getByRole("button", { name: "Convidar por CPF" }).click();
    await expect(page.locator(JANELA)).toBeVisible();
  });


  test("preview de documento e gaveta de documentos (API simulada só de leitura): folha alta, imagem e ações à vista", async ({ page }) => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.route("**/admin/motoristas/*/documentos", (r) =>
      r.request().method() === "GET"
        ? r.fulfill({
            json: [
              { id: "d1", tipo: "CNH", chave: "gaveta:CNH", exigenciaId: null, titulo: null, origem: "PAINEL", nomeArquivo: "cnh-frente.png", mimetype: "image/png", tamanho: 70, validade: null, criadoEm: "2026-09-29T12:00:00Z", alteradoEm: "2026-09-29T12:00:00Z", conferidoEm: null, conferidoPor: null },
            ],
          })
        : r.abort(),
    );
    await page.route("**/admin/motoristas/*/documentos/*/download", (r) => r.fulfill({ body: png, contentType: "image/png" }));
    await abrirRota(page, ROTA_CPF);
    const pular = page.getByRole("button", { name: "Pular" });
    if (await pular.count()) await pular.click();
    await page.getByRole("button", { name: "Documentos" }).first().click();
    const gaveta = page.locator(JANELA);
    await expect(gaveta).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: "tests/ux/resultados/mobile/preview-1-gaveta.png" });
    const r1 = await rect(page);
    expect(Math.round(r1.bottom)).toBe(r1.vh);
    await gaveta.getByRole("button", { name: "Visualizar" }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "tests/ux/resultados/mobile/preview-2-visualizador.png" });
    const dialogos = page.locator(JANELA);
    expect(await dialogos.count()).toBe(2);
    const previa = dialogos.last();
    const b = await previa.boundingBox();
    expect(Math.round(b!.y + b!.height)).toBe(844);
    await expect(previa.getByRole("button", { name: "Baixar" })).toBeInViewport();
    await expect(previa.getByRole("img", { name: "cnh-frente.png" })).toBeVisible();
  });

  test("banner: fechado por padrão (uma linha), abre sob demanda, lembra ao recarregar, e dispensar vale em todos os tamanhos", async ({ page }) => {
    const erros: string[] = [];
    page.on("console", (m) => m.type() === "error" && /hydrat|did not match|Minified React error #4(18|23|25)/i.test(m.text()) && erros.push(m.text()));
    await abrirRota(page, ROTA_CPF);
    const pular = page.getByRole("button", { name: "Pular" });
    if (await pular.count()) await pular.click();
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ronan.sobre-a-tela")).forEach((k) => localStorage.removeItem(k)));
    await page.reload();
    const linha = page.locator("#conteudo").getByRole("button", { name: /Sobre esta tela/ });
    await expect(linha).toBeVisible();
    expect((await linha.boundingBox())!.height).toBeLessThanOrEqual(48);
    await expect(linha).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('section[aria-label="Para que serve esta tela"]')).toHaveCount(0);
    await linha.click();
    await expect(page.locator('section[aria-label="Para que serve esta tela"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('section[aria-label="Para que serve esta tela"]')).toBeVisible(); // lembrou
    await page.getByRole("button", { name: "Entendi, fechar a explicação" }).click();
    await expect(page.locator('section[aria-label="Para que serve esta tela"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('section[aria-label="Para que serve esta tela"]')).toHaveCount(0); // dispensado continua
    // no desktop também continua dispensado: só a linha "Para que serve esta tela"
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("#conteudo").getByRole("button", { name: /Para que serve esta tela/ })).toBeVisible();
    await expect(page.locator('section[aria-label="Para que serve esta tela"]')).toHaveCount(0);
    expect(erros).toEqual([]);
  });
});

test.describe("desktop (MacBook e ultrawide): janela centrada e banner como sempre foi", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === "mobile", "só no desktop"));

  test("janela centrada, cantos e fechar de sempre, sem alça", async ({ page }) => {
    await abrirConvidar(page);
    const r = await rect(page);
    expect(Math.abs((r.left + r.right) / 2 - r.vw / 2)).toBeLessThan(2);
    expect(Math.abs((r.top + r.bottom) / 2 - r.vh / 2)).toBeLessThan(2);
    expect(Math.round(r.w)).toBe(448); // max-w-md do uso, como sempre
    await expect(page.locator(`${JANELA} [data-alca-folha]`)).toBeHidden();
    const fechar = await page.locator(`${JANELA} button:has(.sr-only)`).first().boundingBox();
    expect(fechar!.width).toBeLessThan(30);
  });

  test("banner: aberto na 1ª vez (cartão), igual a antes", async ({ page }) => {
    await abrirRota(page, ROTA_CPF);
    const pular = page.getByRole("button", { name: "Pular" });
    if (await pular.count()) await pular.click();
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ronan.sobre-a-tela")).forEach((k) => localStorage.removeItem(k)));
    await page.reload();
    await expect(page.locator('section[aria-label="Para que serve esta tela"]')).toBeVisible();
    await expect(page.locator("#conteudo").getByRole("button", { name: /Sobre esta tela/ })).toHaveCount(0);
  });
});
