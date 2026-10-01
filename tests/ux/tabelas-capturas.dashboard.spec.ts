import fs from "node:fs";
import path from "node:path";
import { test, abrirRota, estabilizar } from "./ambiente";
import { idsExtras, rotasTabelas } from "./tabelas-rotas";

/**
 * Capturas e medidas das telas com lista/tabela (Leva 1 / fatia 5), pra comparar ANTES x DEPOIS.
 * Só roda com `UX_TABELAS=<pasta>` (fora do `pnpm ux`): grava <pasta>/<projeto>/<rota>.png (a primeira
 * tela, no tamanho do viewport) e <pasta>/<projeto>/medidas.json. Roda nos 3 projetos que importam:
 * mobile (390x844), mac1440 e ultra (3440x1440) — os dois últimos servem pra provar que NADA mudou.
 */
const PASTA = process.env.UX_TABELAS;

test.describe("capturas de tabelas", () => {
  test.skip(!PASTA, "defina UX_TABELAS=<pasta>");
  test.skip(({}, ) => false);

  test("capturar e medir", async ({ page }, info) => {
    test.skip(!["mobile", "mac1440", "ultra"].includes(info.project.name), "só mobile, mac1440 e ultra");
    test.setTimeout(20 * 60_000);
    const dir = path.join(PASTA!, info.project.name);
    fs.mkdirSync(dir, { recursive: true });
    const saida: Record<string, unknown> = {};
    for (const rota of rotasTabelas(await idsExtras())) {
      try {
        await abrirRota(page, rota);
      } catch (e) {
        saida[rota.id] = { erro: String(e).slice(0, 160) };
        continue;
      }
      const pular = page.getByRole("button", { name: "Pular" });
      if (await pular.count()) await pular.click().catch(() => {});
      await estabilizar(page);
      await page.screenshot({ path: path.join(dir, `${rota.id}.png`), animations: "disabled", caret: "hide", scale: "css" });
      const m = await page.evaluate(() => {
        const vis = (el: Element) => {
          const c = getComputedStyle(el);
          if (c.display === "none" || c.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const tabelas = Array.from(document.querySelectorAll("#conteudo table")).filter(vis);
        // "tabela larga" = tabela de verdade (display:table) com 4+ colunas. Em blocos (.tabela-cartoes) o display vira block.
        const largas = tabelas.filter((t) => getComputedStyle(t).display === "table" && (t.querySelector("tr")?.children.length ?? 0) >= 4);
        const fixas = largas.filter((t) => !!t.closest(".tabela-rolagem"));
        const emBlocos = tabelas.filter((t) => t.classList.contains("tabela-cartoes") && getComputedStyle(t).display !== "table");
        const main = document.getElementById("conteudo");
        const ancora = largas[0] ?? emBlocos[0] ?? Array.from(document.querySelectorAll("#conteudo [data-linha-clicavel]")).filter((e) => e.tagName !== "TR" && vis(e))[0];
        return {
          tabelasLargas4mais: largas.length,
          tabelasLargasComColunaFixa: fixas.length,
          tabelasEmBlocos: emBlocos.length,
          cartoesClicaveis: document.querySelectorAll("#conteudo [data-linha-clicavel]:not(tr)").length,
          overflowDoc: document.documentElement.scrollWidth - innerWidth,
          conteudoCortado: main ? main.scrollWidth - main.clientWidth : 0,
          seletorCardsTabela: !!Array.from(document.querySelectorAll("#conteudo button")).find((b) => /^\s*Tabela\s*$/.test(b.textContent ?? "") && vis(b)),
          botaoFiltros: !!Array.from(document.querySelectorAll("#conteudo button")).find((b) => /^\s*Filtros/.test(b.textContent ?? "") && vis(b)),
          alturaDoc: document.documentElement.scrollHeight,
          yLista: ancora ? Math.round(ancora.getBoundingClientRect().top + scrollY) : null,
        };
      });
      saida[rota.id] = m;
      // desktop: a página INTEIRA (a paginação e o fim das listas ficam abaixo da 1ª tela) — prova de que nada mudou
      if (info.project.name !== "mobile") {
        await page.screenshot({ path: path.join(dir, `${rota.id}-full.png`), fullPage: true, animations: "disabled", caret: "hide", scale: "css" });
      }
      // onde a lista começa (muitas telas têm a lista abaixo do 1º viewport): uma faixa de 1 tela a partir dela
      if (info.project.name === "mobile" && m.yLista != null && m.yLista > 700) {
        const vp = page.viewportSize()!;
        await page.screenshot({
          path: path.join(dir, `${rota.id}-lista.png`),
          fullPage: true,
          clip: { x: 0, y: Math.max(0, m.yLista - 90), width: vp.width, height: vp.height },
          animations: "disabled",
          caret: "hide",
          scale: "css",
        });
      }
    }
    fs.writeFileSync(path.join(dir, "medidas.json"), JSON.stringify(saida, null, 1));
  });
});
