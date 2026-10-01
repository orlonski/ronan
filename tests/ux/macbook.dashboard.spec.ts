import type { Page } from "@playwright/test";
import { test, expect, abrirRota, entrarComo } from "./ambiente";
import { ROTAS } from "./rotas";
import { CHAVE_MENU, MENU_FIXO, MENU_RECOLHIDO } from "../e2e/helpers/menu";

/**
 * MacBook compacto (Leva 2 / fatia 4): menu recolhido numa gaveta entre 768 e 1535px, preferência
 * "fixar" por pessoa, densidade (~6%), cartões em 2 colunas de 1024 a 1535px. De 1536px pra cima
 * NADA disso existe (o ultrawide é provado pelo baseline visual do projeto `ultra`; aqui só o
 * comportamento do menu).
 *
 * Só no projeto `mac1440`: o viewport é trocado por teste (1280, 1440, 1470, 1512, 1535, 1536, 1728).
 */
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "mac1440", "o viewport é trocado dentro do teste; roda uma vez só");
});

const FAIXA = [1280, 1440, 1470, 1512, 1535];
const FIXO_SEMPRE = [1536, 1728, 3440];
const rota = (id: string) => ROTAS.find((r) => r.id === id)!;

async function abrir(page: Page, id: string, w: number): Promise<void> {
  await page.setViewportSize({ width: w, height: w >= 3000 ? 1440 : 900 });
  await abrirRota(page, rota(id));
  // O passo a passo da home abre por cima (a suíte não grava "visto"): pula pra liberar o clique.
  const pular = page.getByRole("button", { name: "Pular" });
  if (await pular.count()) await pular.click();
  await expect(page.getByRole("dialog", { name: "Passo a passo" })).toHaveCount(0);
}

const aside = (page: Page) => page.locator("aside#menu-lateral");
const hamburguer = (page: Page) => page.getByRole("button", { name: "Abrir menu" });
const mainEsq = (page: Page) => page.evaluate(() => Math.round(document.getElementById("conteudo")!.getBoundingClientRect().left));
const dataMenu = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-menu"));
const guardado = (page: Page) => page.evaluate((c) => localStorage.getItem(c), CHAVE_MENU);

test.describe("faixa 768–1535px: menu recolhido por padrão", () => {
  for (const w of FAIXA) {
    test(`${w}px: sem preferência o menu é gaveta fechada, hambúrguer à vista, conteúdo usa a largura toda`, async ({ page }) => {
      await abrir(page, "viagens", w);
      expect(await dataMenu(page)).toBe(MENU_RECOLHIDO);
      await expect(aside(page)).toBeHidden();
      await expect(hamburguer(page)).toBeVisible();
      const b = (await hamburguer(page).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(40);
      expect(b.height).toBeGreaterThanOrEqual(40);
      expect(await mainEsq(page)).toBe(0);
      // densidade: html a 15px na faixa
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("15px");
      // sem rolagem lateral
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    });
  }

  test("abrir pelo hambúrguer, fechar com Esc, clique fora e ao navegar", async ({ page }) => {
    await abrir(page, "viagens", 1440);
    await hamburguer(page).click();
    await expect(aside(page)).toBeVisible();
    await expect(hamburguer(page)).toHaveAttribute("aria-expanded", "true");
    // a gaveta desliza (0,2s): espera chegar
    await expect.poll(async () => Math.round((await aside(page).boundingBox())!.x)).toBe(0);
    expect(Math.round((await aside(page).boundingBox())!.width)).toBe(240); // 16rem com html a 15px
    // os MESMOS itens do menu fixo: links, Sair, tema
    await expect(aside(page).getByRole("link", { name: "Viagens", exact: true }).first()).toBeVisible();
    await expect(aside(page).getByRole("button", { name: "Sair" })).toBeVisible();
    await expect(aside(page).getByRole("button", { name: "Fixar menu" })).toBeVisible();
    await expect(aside(page).getByRole("button", { name: "Soltar menu" })).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(aside(page)).toBeHidden();
    await expect(hamburguer(page)).toHaveAttribute("aria-expanded", "false");

    await hamburguer(page).click();
    await expect(aside(page)).toBeVisible();
    await page.mouse.click(1000, 400); // fora da gaveta: no fundo escurecido
    await expect(aside(page)).toBeHidden();

    await hamburguer(page).click();
    // um link do grupo que está aberto (o accordion abre o grupo da rota atual)
    const destino = aside(page).locator("nav a[href]:not([aria-current])").first();
    const href = (await destino.getAttribute("href"))!;
    await destino.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[/?]/g, "\\$&")));
    await expect(aside(page)).toBeHidden(); // fechou ao navegar
    expect(await guardado(page)).toBeNull(); // abrir/fechar não grava preferência nenhuma
  });

  test("Fixar menu: grava a preferência, o menu volta pro fluxo e sobrevive ao recarregar; Soltar desfaz", async ({ page }) => {
    await abrir(page, "viagens", 1280);
    await hamburguer(page).click();
    await aside(page).getByRole("button", { name: "Fixar menu" }).click();
    expect(await guardado(page)).toBe(MENU_FIXO);
    expect(await dataMenu(page)).toBe(MENU_FIXO);
    await expect(aside(page)).toBeVisible();
    await expect(hamburguer(page)).toBeHidden();
    expect(await mainEsq(page)).toBe(240); // 16rem a 15px: a sidebar ocupa lugar, como no desktop
    await expect(aside(page).getByRole("button", { name: "Soltar menu" })).toBeVisible();
    await expect(aside(page).getByRole("button", { name: "Fixar menu" })).toBeHidden();

    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(await dataMenu(page)).toBe(MENU_FIXO);
    await expect(aside(page)).toBeVisible();
    expect(await mainEsq(page)).toBe(240);

    await aside(page).getByRole("button", { name: "Soltar menu" }).click();
    expect(await guardado(page)).toBe(MENU_RECOLHIDO);
    await expect(aside(page)).toBeHidden();
    await expect(hamburguer(page)).toBeVisible();
    expect(await mainEsq(page)).toBe(0);
  });

  test("com `ronan.menu=fixo` (helper dos E2E) o menu nasce aberto em 1280", async ({ page }) => {
    await page.context().addInitScript(([c, v]) => localStorage.setItem(c!, v!), [CHAVE_MENU, MENU_FIXO]);
    await abrir(page, "viagens", 1280);
    await expect(aside(page)).toBeVisible();
    await expect(hamburguer(page)).toBeHidden();
    expect(await dataMenu(page)).toBe(MENU_FIXO);
  });

  for (const pref of [MENU_FIXO, null]) {
    test(`sem piscar (preferência ${pref ?? "nenhuma"}): \`data-menu\` existe antes de o <body> ser lido`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.context().addInitScript((p) => {
        // Roda antes de qualquer script da página, com o documento ainda vazio.
        (window as any).__menuTrilha = [];
        // observa o `document` (o <html> ainda pode não existir quando este script roda)
        new MutationObserver(() => {
          (window as any).__menuTrilha.push({
            valor: document.documentElement.getAttribute("data-menu"),
            temBody: !!document.body,
          });
        }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-menu"] });
        try {
          if (p) localStorage.setItem("ronan.menu", p);
          else localStorage.removeItem("ronan.menu");
        } catch {
          /* sem storage */
        }
      }, pref);
      await abrirRota(page, rota("viagens"));
      const trilha = (await page.evaluate(() => (window as any).__menuTrilha)) as { valor: string; temBody: boolean }[];
      expect(trilha.length, "o script do <head> pôs o atributo").toBeGreaterThan(0);
      expect(trilha[0]!.temBody, "o atributo foi posto antes de existir <body>").toBe(false);
      // nunca mudou de valor depois (aberto -> recolhido seria o "piscar")
      expect(new Set(trilha.map((t) => t.valor)).size).toBe(1);
    });
  }

  test("gaveta tem tema, usuário e Sair; super admin tem o seletor de empresa", async ({ page }) => {
    await entrarComo(page, "super");
    await abrir(page, "viagens", 1440);
    await hamburguer(page).click();
    await expect(aside(page).getByRole("button", { name: "Sair" })).toBeVisible();
    await expect(aside(page).getByText("Super administrador")).toBeVisible();
    // ContaSwitcher dentro da gaveta: abre por cima dela e o Esc fecha só ele, não a gaveta
    await aside(page).getByRole("button", { name: "Trocar de empresa" }).click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await expect(aside(page)).toBeVisible();
  });
});

test.describe("1536px+ (ultrawide e MacBook Pro 16 a 1728): menu SEMPRE fixo, como antes", () => {
  for (const w of FIXO_SEMPRE) {
    for (const pref of [null, MENU_RECOLHIDO]) {
      test(`${w}px, preferência ${pref ?? "(nenhuma)"}: sidebar de 256px, sem hambúrguer, sem Fixar/Soltar, html a 16px`, async ({ page }) => {
        if (pref) await page.context().addInitScript(([c, v]) => localStorage.setItem(c!, v!), [CHAVE_MENU, pref]);
        await abrir(page, "viagens", w);
        await expect(aside(page)).toBeVisible();
        await expect(hamburguer(page)).toBeHidden();
        await expect(aside(page).getByRole("button", { name: "Fixar menu" })).toBeHidden();
        await expect(aside(page).getByRole("button", { name: "Soltar menu" })).toBeHidden();
        expect(await mainEsq(page)).toBe(256);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("16px");
        const pad = await page.evaluate(() => getComputedStyle(document.getElementById("conteudo")!).paddingLeft);
        expect(pad).toBe("32px"); // p-8, como antes
      });
    }
  }
});

test.describe("cartões das listas: grade de 2 colunas só de 1024 a 1535px", () => {
  const porLinha = (page: Page) =>
    page.evaluate(() => {
      const cs = Array.from(document.querySelectorAll("#conteudo [data-linha-clicavel]")).filter((e) => e.tagName !== "TR" && e.getBoundingClientRect().width > 0);
      if (cs.length < 2) return { n: cs.length, naLinha: cs.length };
      const top = cs[0]!.getBoundingClientRect().top;
      return { n: cs.length, naLinha: cs.filter((e) => Math.abs(e.getBoundingClientRect().top - top) < 4).length };
    });

  for (const [w, esperado] of [[1280, 2], [1440, 2], [1512, 2], [1535, 2], [1536, 1], [1728, 1], [1023, 1]] as const) {
    test(`/motoristas em ${w}px: ${esperado} cartão(ões) por linha`, async ({ page }) => {
      await abrir(page, "motoristas", w);
      const r = await porLinha(page);
      expect(r.n, "o seed tem motoristas pra formar a grade").toBeGreaterThan(1);
      expect(r.naLinha).toBe(esperado);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    });
  }
});

test.describe("passo a passo (tour) no MacBook com o menu recolhido", () => {
  test("percorre todos os passos sem travar e o foco de luz nunca cai fora da tela", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await abrirRota(page, rota("home"));
    const tour = page.getByRole("dialog", { name: "Passo a passo" });
    await expect(tour).toBeVisible({ timeout: 15_000 });
    let passos = 0;
    for (;;) {
      const furo = await tour.locator("svg rect[stroke]").first().boundingBox().catch(() => null);
      if (furo) {
        expect(furo.x, "furo dentro da tela (x)").toBeGreaterThanOrEqual(-1);
        expect(furo.y).toBeGreaterThanOrEqual(-12); // o furo tem 10px de folga: no topo da tela encosta na borda
        expect(furo.x + furo.width).toBeLessThanOrEqual(1441);
        expect(furo.width).toBeGreaterThan(20);
      }
      passos++;
      const entendi = tour.getByRole("button", { name: "Entendi" });
      if (await entendi.count()) {
        await entendi.click();
        break;
      }
      await tour.getByRole("button", { name: "Próximo", exact: true }).click();
      expect(passos).toBeLessThan(30);
    }
    expect(passos).toBeGreaterThan(1);
    await expect(tour).toHaveCount(0);
  });

  test("âncoras do menu: com a gaveta fechada o alvo é o hambúrguer; fixo, o item do menu", async ({ page }) => {
    await abrir(page, "home", 1440);
    const ancoras = await hamburguer(page).getAttribute("data-coach");
    for (const chave of ["comecar", "grupo-lancamentos", "grupo-dia-a-dia"]) expect(ancoras).toContain(chave);
    // medirAlvo ignora o que está `visibility: hidden` (a gaveta fechada, parada fora da tela)
    const alvo = await page.evaluate(() => {
      const todos = Array.from(document.querySelectorAll<HTMLElement>('[data-coach~="grupo-lancamentos"]'));
      for (const el of todos) {
        if (getComputedStyle(el).visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) return el.getAttribute("aria-label");
      }
      return null;
    });
    expect(alvo).toBe("Abrir menu");
  });
});
