import fs from "node:fs";
import path from "node:path";
import { test, abrirRota, entrarComo, estabilizar } from "./ambiente";
import { ROTAS } from "./rotas";

/**
 * Capturas e medidas da faixa MacBook (Leva 2 / fatia 4), pra comparar ANTES x DEPOIS.
 * Só roda com `UX_CAPTURAS=<pasta>` (fora do `pnpm ux`): grava <pasta>/<largura>/<rota>.png e
 * <pasta>/medidas.json. `UX_LARGURAS=1280,1440,1512,1728,3440` troca as larguras;
 * `UX_MENU=fixo` grava a preferência `ronan.menu=fixo` antes (menu fixo, como era antes da fatia).
 * Só roda no projeto mac1440 (o viewport é trocado por largura dentro do teste).
 */
const PASTA = process.env.UX_CAPTURAS;
const LARGURAS = (process.env.UX_LARGURAS ?? "1280,1440,1512,1728,3440").split(",").map(Number);
const ALTURA = (l: number) => (l >= 3000 ? 1440 : l >= 1700 ? 1117 : l >= 1500 ? 982 : l >= 1400 ? 900 : 800);

test.describe("capturas MacBook", () => {
  test.skip(!PASTA, "defina UX_CAPTURAS=<pasta>");
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "mac1440", "só no projeto mac1440");
  });

  test("capturar e medir", async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const saida: Record<string, Record<string, unknown>> = {};
    if (process.env.UX_MENU === "fixo") {
      await page.context().addInitScript(() => {
        try { localStorage.setItem("ronan.menu", "fixo"); } catch { /* sem storage */ }
      });
    }
    for (const w of LARGURAS) {
      await page.setViewportSize({ width: w, height: ALTURA(w) });
      fs.mkdirSync(path.join(PASTA!, String(w)), { recursive: true });
      for (const rota of ROTAS) {
        // O cookie do super (rota /whatsapp) ficaria no contexto e as telas seguintes abriam como ele.
        await entrarComo(page, rota.usuario === "super" ? "super" : "admin");
        await abrirRota(page, rota);
        await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
        // o passo a passo da home abre sozinho (a suíte não grava "visto"): pula pra ver a tela
        const pular = page.getByRole("button", { name: "Pular" });
        if (await pular.count()) await pular.click().catch(() => {});
        await estabilizar(page);
        await page.screenshot({ path: path.join(PASTA!, String(w), `${rota.id}.png`), animations: "disabled", caret: "hide", scale: "css" });
        const m = await page.evaluate(() => {
          const main = document.getElementById("conteudo");
          const mr = main?.getBoundingClientRect();
          const vis = (el: Element) => {
            const c = getComputedStyle(el);
            if (c.display === "none" || c.visibility === "hidden") return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const campos = Array.from(main?.querySelectorAll("input,select,textarea,button[role=combobox]") ?? []).filter((e) => {
            const t = (e as HTMLInputElement).type;
            if (t === "checkbox" || t === "radio" || t === "hidden" || t === "file") return false;
            return vis(e);
          });
          const estreitos = campos.filter((e) => e.getBoundingClientRect().width < 120);
          const aside = document.querySelector("aside");
          // largura do conteúdo "de verdade": o maior right dos filhos do main
          let util = 0;
          if (main) for (const el of Array.from(main.querySelectorAll("*"))) {
            if (!vis(el)) continue;
            const r = el.getBoundingClientRect();
            util = Math.max(util, r.right);
          }
          return {
            vw: innerWidth,
            mainLeft: mr ? Math.round(mr.left) : null,
            mainWidth: mr ? Math.round(mr.width) : null,
            utilDireita: Math.round(util),
            camposMenor120: estreitos.length,
            camposTotal: campos.length,
            asideVisivel: !!aside && vis(aside) && aside.getBoundingClientRect().right > 0,
            dataMenu: document.documentElement.getAttribute("data-menu"),
            fonteRaiz: getComputedStyle(document.documentElement).fontSize,
            overflowH: document.documentElement.scrollWidth - innerWidth,
            // 2 colunas de cartão? conta quantos [data-linha-clicavel] estão na mesma linha do 1º
            cartoesPorLinha: (() => {
              const cs = Array.from(document.querySelectorAll("#conteudo [data-linha-clicavel]")).filter((e) => e.tagName !== "TR" && vis(e));
              if (!cs.length) return 0;
              const top = cs[0]!.getBoundingClientRect().top;
              return cs.filter((e) => Math.abs(e.getBoundingClientRect().top - top) < 4).length;
            })(),
          };
        });
        (saida[String(w)] ??= {})[rota.id] = m;
      }
    }
    fs.writeFileSync(path.join(PASTA!, "medidas.json"), JSON.stringify(saida, null, 1));
  });
});
