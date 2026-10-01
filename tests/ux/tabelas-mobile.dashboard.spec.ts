import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, abrirRota, estabilizar } from "./ambiente";
import { idsExtras, rotasTabelas } from "./tabelas-rotas";

/**
 * Tabelas como cartões e filtros no celular (Leva 1, fatia 5).
 * `mobile`: o cartão automático, o seletor Cards/Tabela escondido, a folha de filtros, o menu "⋯" do cartão de
 * motorista, a paginação enxuta e as tabelas cruas (blocos / rolagem com coluna fixa).
 * `mac1440` e `ultra`: a prova de que o desktop segue com tabela, seletor, filtros inline e paginação completa.
 * Só abre e olha: nada é confirmado (e o contexto aborta qualquer escrita).
 *
 * Com `UX_TABELAS=<pasta>` também grava as capturas das janelas abertas (folha de filtros, menu ⋯) em <pasta>/mobile/.
 */
const PASTA = process.env.UX_TABELAS;
const rota = (id: string, url: string) => ({ id, rotulo: id, url });

async function pularTour(page: Page) {
  const pular = page.getByRole("button", { name: "Pular" });
  if (await pular.count()) await pular.click().catch(() => {});
}
async function abrir(page: Page, url: string, id = "x") {
  await abrirRota(page, rota(id, url));
  await pularTour(page);
}
async function capturar(page: Page, nome: string) {
  if (!PASTA) return;
  fs.mkdirSync(path.join(PASTA, "mobile"), { recursive: true });
  await estabilizar(page);
  await page.screenshot({ path: path.join(PASTA, "mobile", `${nome}.png`), animations: "disabled", caret: "hide", scale: "css" });
}
/** Tabelas de verdade (display:table) visíveis com 4+ colunas dentro do conteúdo. */
const tabelasLargas = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("#conteudo table")).filter((t) => {
      const r = t.getBoundingClientRect();
      return getComputedStyle(t).display === "table" && r.width > 0 && r.height > 0 && (t.querySelector("tr")?.children.length ?? 0) >= 4;
    }).length,
  );
const alvo = async (loc: ReturnType<Page["locator"]>) => {
  const b = await loc.boundingBox();
  expect(b, "elemento sem caixa (invisível?)").not.toBeNull();
  return b!;
};

test.describe("celular", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "só no celular"));

  test("cartão automático: a tabela do local vira cartões, clicáveis, com ordenação e ação interna", async ({ page }) => {
    const ids = JSON.parse(fs.readFileSync(path.join(__dirname, ".stack", "seed-ids.json"), "utf8")) as { local: string };
    await abrir(page, `/locais/${ids.local}`);
    expect(await tabelasLargas(page)).toBe(0);
    const cartoes = page.locator("#conteudo [data-linha-clicavel]:not(tr)");
    await expect(cartoes.first()).toBeVisible();
    expect(await cartoes.count()).toBeGreaterThan(3);
    // título (ticket), selo (status) e campos com rótulo
    const primeiro = cartoes.first();
    await expect(primeiro).toContainText(/Lado/);
    await expect(primeiro).toContainText(/Motorista/);
    await expect(primeiro).toContainText(/Obra/);
    // ordenação que o cabeçalho da tabela dava continua à mão
    await expect(page.getByText("Ordenar por:").first()).toBeVisible();
    // o cartão inteiro abre a viagem; o botão de dentro também navega (é um link) sem disparar duas vezes
    await primeiro.locator('a[href^="/viagens/"]').first().click();
    await expect(page).toHaveURL(/\/viagens\/[0-9a-f-]{36}/);
    await page.goBack();
    await expect(cartoes.first()).toBeVisible();
    await cartoes.first().locator("dl").click({ position: { x: 5, y: 5 } });
    await expect(page).toHaveURL(/\/viagens\/[0-9a-f-]{36}/);
  });

  test("o seletor Cards/Tabela some e a preferência 'tabela' salva NÃO vale (nem é apagada)", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("ronan.view-mode.viagens", "table");
        localStorage.setItem("ronan.view-mode.motoristas", "table");
      } catch {
        /* sem storage */
      }
    });
    for (const url of ["/viagens", "/motoristas"]) {
      await abrir(page, url);
      await expect(page.getByRole("button", { name: "Tabela" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Cards" })).toBeHidden();
      expect(await tabelasLargas(page), `${url}: tabela larga no celular`).toBe(0);
      await expect(page.locator("#conteudo a[href^='/viagens/'], #conteudo [data-linha-clicavel]:not(tr)").first()).toBeVisible();
    }
    const guardado = await page.evaluate(() => localStorage.getItem("ronan.view-mode.viagens"));
    expect(guardado, "a preferência do desktop foi apagada").toBe("table");
  });

  test("a toolbar vira UMA linha (busca + Filtros) e os filtros abrem numa folha de baixo", async ({ page }) => {
    await abrir(page, "/viagens");
    const busca = page.getByRole("textbox", { name: /Buscar por ticket/ });
    const botao = page.getByRole("button", { name: /^Filtros/ });
    await expect(busca).toBeVisible();
    await expect(botao).toBeVisible();
    const b1 = await alvo(busca);
    const b2 = await alvo(botao);
    expect(Math.abs(b1.y - b2.y), "busca e botão Filtros na mesma linha").toBeLessThan(12);
    expect(b2.height).toBeGreaterThanOrEqual(44);
    // os filtros de verdade NÃO estão à vista: só dentro da folha
    await expect(page.getByRole("combobox", { name: /Status/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Status/ })).toBeHidden();
    await botao.click();
    const folha = page.locator('[role="dialog"][data-folha="baixo"]');
    await expect(folha).toBeVisible();
    await expect(folha.getByRole("heading", { name: "Filtros" })).toBeVisible();
    const r = await folha.boundingBox();
    expect(Math.round(r!.y + r!.height)).toBe(844); // ancorada embaixo
    for (const nome of ["Limpar", "Aplicar"]) {
      const bb = await alvo(folha.getByRole("button", { name: nome, exact: true }));
      expect(bb.height, `${nome} >= 44px`).toBeGreaterThanOrEqual(44);
    }
    await page.waitForTimeout(400);
    await capturar(page, "_folha-filtros-viagens");

    // os MESMOS controles, o MESMO estado/URL: escolher "Divergente" muda a URL e o contador
    await folha.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("button", { name: "Divergente", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("DIVERGENTE");
    await expect(folha.getByRole("heading", { name: "Filtros (1)" })).toBeVisible();
    await folha.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(folha).toBeHidden();
    await expect(page.getByRole("button", { name: /Filtros, 1 ativo/ })).toBeVisible();
    await page.waitForTimeout(500);
    await capturar(page, "_viagens-filtrada");

    // Limpar zera filtro e contador e fecha
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await folha.getByRole("button", { name: "Limpar", exact: true }).click();
    await expect(folha).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBeNull();
    await expect(page.getByRole("button", { name: "Filtros", exact: true })).toBeVisible();
  });

  test("a folha de filtros funciona nas outras telas de lista e relatório", async ({ page }) => {
    for (const [url, busca] of [
      ["/motoristas", /Buscar por nome, CPF/],
      ["/locais", /Buscar por nome, endereço/],
      ["/abastecimentos", /Buscar por posto/],
    ] as const) {
      await abrir(page, url);
      await expect(page.getByRole("textbox", { name: busca })).toBeVisible();
      await page.getByRole("button", { name: /^Filtros/ }).click();
      const folha = page.locator('[role="dialog"][data-folha="baixo"]');
      await expect(folha).toBeVisible();
      expect(await folha.getByRole("button").count(), `${url}: filtros dentro da folha`).toBeGreaterThan(3);
      await capturar(page, `_folha-filtros-${url.slice(1)}`);
      await folha.getByRole("button", { name: "Aplicar", exact: true }).click();
      await expect(folha).toBeHidden();
    }
    // relatório (toolbar sem busca): só o botão
    await abrir(page, "/relatorios/viagens");
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await expect(page.locator('[role="dialog"][data-folha="baixo"]')).toBeVisible();
    await capturar(page, "_folha-filtros-relatorios-viagens");
  });

  test("paginação enxuta: Anterior / pág X de Y / Próxima de 44px, sem 'por página' nem primeira/última", async ({ page }) => {
    await abrir(page, "/viagens");
    const pag = page.getByText(/Pág\./).first();
    await pag.scrollIntoViewIfNeeded();
    await expect(pag).toBeVisible();
    await expect(page.getByText("Por página")).toBeHidden();
    await expect(page.getByRole("button", { name: "Primeira página" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Última página" })).toBeHidden();
    for (const nome of ["Anterior", "Próxima"]) {
      const bb = await alvo(page.getByRole("button", { name: nome, exact: true }));
      expect(bb.height, `${nome} >= 44px`).toBeGreaterThanOrEqual(44);
      expect(bb.width, `${nome} >= 44px`).toBeGreaterThanOrEqual(44);
    }
    // "Próxima" funciona: vai pra página 2 (a URL grava page=2)
    await page.getByRole("button", { name: "Próxima", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
    await expect(page.getByText(/Pág\./).first().locator("xpath=..")).toContainText(/2\s*de/);
  });

  test("cartão de motorista: faixa só com Ativo + Editar + ⋯; as demais ações moram no menu e continuam funcionando", async ({ page }) => {
    await abrir(page, "/motoristas");
    const cartao = page.locator("#conteudo [data-linha-clicavel]:not(tr)").first();
    await expect(cartao).toBeVisible();
    // à vista: toggle Ativo, Editar e ⋯ — o resto some da faixa
    await expect(cartao.getByRole("switch")).toBeVisible();
    await expect(cartao.getByRole("button", { name: "Editar" })).toBeVisible();
    for (const t of ["Documentos", "Enviar notificação push", "Enviar resumo do dia agora", "Gerar convite WhatsApp", "Excluir definitivamente"]) {
      await expect(cartao.getByTitle(t, { exact: true }).first(), `${t} fora da faixa`).toBeHidden();
    }
    const mais = cartao.getByRole("button", { name: /^Mais ações de / });
    const bb = await alvo(mais);
    expect(bb.width).toBeGreaterThanOrEqual(44);
    expect(bb.height).toBeGreaterThanOrEqual(44);
    // tocar no ⋯ NÃO abre a ficha
    const urlAntes = page.url();
    await mais.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    expect(page.url()).toBe(urlAntes);
    for (const t of ["Documentos", "Enviar notificação push", "Enviar resumo do dia", "Gerar convite WhatsApp", "Excluir definitivamente"]) {
      await expect(menu.getByRole("menuitem", { name: new RegExp(t, "i") }).first(), `menu tem ${t}`).toBeVisible();
    }
    await page.waitForTimeout(400); // o menu entra com zoom: medir depois da animação
    for (const item of await menu.getByRole("menuitem").all()) {
      const ib = await item.boundingBox();
      expect(ib!.height, "item do menu >= 44px").toBeGreaterThanOrEqual(44);
    }
    await capturar(page, "_menu-mais-motorista");

    // Documentos abre a gaveta de documentos do motorista
    await menu.getByRole("menuitem", { name: /Documentos/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/Documentos/i);
    await capturar(page, "_menu-mais-documentos");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Excluir pede confirmação (e aqui a gente só olha e volta: nada é excluído)
    await mais.click();
    await page.getByRole("menu").getByRole("menuitem", { name: /Excluir definitivamente/ }).click();
    const conf = page.getByRole("dialog");
    await expect(conf).toBeVisible();
    await expect(conf).toContainText(/Excluir o motorista/);
    await capturar(page, "_menu-mais-excluir");
    await conf.getByRole("button", { name: /Cancelar|Voltar/ }).first().click();
    await expect(conf).toBeHidden();
    // o corpo continua clicável depois dos diálogos (sem pointer-events preso)
    await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");

    // o cartão ainda abre a ficha pelo corpo
    await cartao.getByText(/viagens/).first().click();
    await expect(page).toHaveURL(/\/motoristas\/[0-9a-f-]{36}$/);
  });

  test("tabelas cruas: relatórios e eventos viram blocos; espelho de ponto rola com a coluna Dia fixa", async ({ page }) => {
    const ex = await idsExtras();
    const rotas = rotasTabelas(ex);
    const url = (id: string) => rotas.find((r) => r.id === id)!.url;
    for (const id of ["relatorios-viagens", "relatorios-abastecimentos", "relatorios-consumo", "tipos-evento-viagem", "campos-layout"]) {
      await abrir(page, url(id), id);
      const t = page.locator("#conteudo table.tabela-cartoes").first();
      await expect(t, `${id}: tabela em blocos`).toBeVisible();
      expect(await t.evaluate((e) => getComputedStyle(e).display), `${id}: não é mais display:table`).toBe("block");
      expect(await tabelasLargas(page), `${id}: sem tabela larga`).toBe(0);
      // sem rolagem lateral do documento nem do conteúdo por causa da tabela
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      // cada linha tem rótulo nos campos
      expect(await t.locator("td[data-rotulo]").count()).toBeGreaterThan(3);
    }
    // espelho: tabular de verdade -> rola DENTRO do contêiner, 1ª coluna fixa
    await abrir(page, url("ponto-espelho"), "espelho");
    const cont = page.locator("#conteudo .tabela-rolagem").first();
    await expect(cont).toBeVisible();
    expect(await cont.evaluate((e) => e.scrollWidth > e.clientWidth), "rola de lado").toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "o documento não rola").toBe(0);
    const pos = await cont.locator("tbody tr").first().locator("td").first().evaluate((e) => getComputedStyle(e).position);
    expect(pos).toBe("sticky");
    await cont.evaluate((e) => e.scrollTo(200, 0));
    await page.waitForTimeout(200);
    const primeira = await alvo(cont.locator("tbody tr").first().locator("td").first());
    const contBox = await alvo(cont);
    expect(Math.abs(primeira.x - contBox.x), "1ª coluna colada na borda mesmo rolando").toBeLessThan(3);
    await capturar(page, "_espelho-rolado");
  });
});

test.describe("desktop (nada mudou)", () => {
  test.beforeEach(({}, info) => test.skip(!["mac1440", "ultra"].includes(info.project.name), "só desktop"));

  test("seletor Cards/Tabela visível, preferência 'tabela' vale, filtros inline e paginação completa", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("ronan.view-mode.viagens", "table");
      } catch {
        /* sem storage */
      }
    });
    await abrir(page, "/viagens");
    await expect(page.getByRole("button", { name: "Tabela" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cards" })).toBeVisible();
    expect(await tabelasLargas(page), "a tabela aparece quando a preferência é 'tabela'").toBe(1);
    // filtros à vista (não escondidos numa folha), botão "Filtros" não existe
    await expect(page.getByRole("button", { name: /^Status/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Filtros/ })).toBeHidden();
    // paginação completa
    await expect(page.getByText("Por página")).toBeVisible();
    await expect(page.getByRole("button", { name: "Primeira página" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Última página" })).toBeVisible();
    await expect(page.getByText(/Pág\./)).toBeHidden();
    await expect(page.getByText(/Página/).first()).toBeVisible();
  });

  test("tabelas cruas seguem tabelas; faixa de ações do motorista segue completa", async ({ page }) => {
    await abrir(page, "/relatorios/viagens");
    expect(await tabelasLargas(page)).toBe(1);
    await expect(page.locator("#conteudo thead").first()).toBeVisible();
    await abrir(page, "/motoristas");
    const cartao = page.locator("#conteudo [data-linha-clicavel]:not(tr)").first();
    await expect(cartao.getByRole("button", { name: /^Mais ações de / })).toBeHidden();
    for (const t of ["Documentos", "Editar", "Gerar convite WhatsApp", "Excluir definitivamente"]) {
      await expect(cartao.getByTitle(t, { exact: true }).first(), `${t} na faixa`).toBeVisible();
    }
  });
});
