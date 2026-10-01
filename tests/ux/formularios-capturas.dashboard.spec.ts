import fs from "node:fs";
import path from "node:path";
import { test, abrirRota, estabilizar, entrarComo, DASH } from "./ambiente";
import { rotasDeFormulario } from "./formularios-rotas";

/**
 * Capturas dos formulários (Leva 1 / fatia 6), pra comparar ANTES x DEPOIS. Só roda com `UX_CAPTURAS=<pasta>`
 * (fora do `pnpm ux`). Projeto `mobile`: 390x844 no topo, no meio e no fim da rolagem + um campo focado com o
 * teclado do iPhone simulado (visualViewport 390x520). Projeto `mac1440`: 1440 e 3440 (topo e fim) pra provar
 * que o desktop não mudou. Grava PNG + `medidas.json` (posição do botão Salvar, folga do último campo).
 * Só abre e olha: o contexto do `test` aborta qualquer escrita.
 */
const PASTA = process.env.UX_CAPTURAS;

test.describe("capturas de formulários", () => {
  test.skip(!PASTA, "defina UX_CAPTURAS=<pasta>");

  test("capturar e medir", async ({ page }, info) => {
    test.setTimeout(20 * 60_000);
    const mobile = info.project.name === "mobile";
    const larguras = mobile ? [390] : info.project.name === "mac1440" ? [1440, 3440] : [];
    test.skip(larguras.length === 0, "só mobile e mac1440");
    const rotas = await rotasDeFormulario();
    const medidas: Record<string, unknown> = {};
    const pular = async () => {
      const b = page.getByRole("button", { name: "Pular" });
      if (await b.count()) await b.click().catch(() => {});
    };
    for (const w of larguras) {
      if (!mobile) await page.setViewportSize({ width: w, height: w >= 3000 ? 1440 : 900 });
      const dir = path.join(PASTA!, String(w));
      fs.mkdirSync(dir, { recursive: true });
      for (const rota of rotas) {
        await abrirRota(page, rota);
        await pular();
        await estabilizar(page);
        const foto = (nome: string) => page.screenshot({ path: path.join(dir, `${rota.id}.${nome}.png`), animations: "disabled", caret: "hide", scale: "css" });
        const rolar = (frac: number) =>
          page.evaluate((f) => {
            const main = document.getElementById("conteudo");
            const el = main && main.scrollHeight > main.clientHeight ? main : document.scrollingElement!;
            el.scrollTo(0, (el.scrollHeight - el.clientHeight) * f);
          }, frac);
        const medir = () =>
          page.evaluate(() => {
            const vis = (e: Element) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none"; };
            const botoes = Array.from(document.querySelectorAll("#conteudo button[type=submit], main button[type=submit], form button[type=submit]")).filter(vis);
            const salvar = botoes[0]?.getBoundingClientRect();
            const barra = document.querySelector("[data-barra-de-acao-fixa]");
            const br = barra && vis(barra) ? barra.getBoundingClientRect() : null;
            // último campo/rótulo visível na ordem do documento (sem contar a barra)
            const campos = Array.from(document.querySelectorAll("#conteudo input:not([type=hidden]), #conteudo select, #conteudo textarea, #conteudo button[role=combobox], #conteudo label")).filter((e) => vis(e) && !(barra && barra.contains(e)));
            const ult = campos[campos.length - 1]?.getBoundingClientRect();
            return {
              barraFixa: br ? { top: Math.round(br.top), bottom: Math.round(br.bottom), h: Math.round(br.height), w: Math.round(br.width), position: getComputedStyle(barra!).position } : null,
              salvar: salvar ? { top: Math.round(salvar.top), bottom: Math.round(salvar.bottom), w: Math.round(salvar.width), h: Math.round(salvar.height), x: Math.round(salvar.left) } : null,
              ultimoCampoBottom: ult ? Math.round(ult.bottom) : null,
              vh: window.innerHeight,
              rolagemTotal: (document.getElementById("conteudo")?.scrollHeight ?? 0),
            };
          });
        const m: Record<string, unknown> = {};
        await rolar(0); await page.waitForTimeout(200);
        await foto("1-topo"); m.topo = await medir();
        if (mobile) {
          await rolar(0.5); await page.waitForTimeout(200); await foto("2-meio"); m.meio = await medir();
        }
        await rolar(1); await page.waitForTimeout(300);
        await foto("3-fim"); m.fim = await medir();
        if (mobile) {
          // campo focado com o teclado do iPhone (só a área visível encolhe)
          await rolar(0.3); await page.waitForTimeout(200);
          await page.evaluate(() => {
            const vv = window.visualViewport!;
            Object.defineProperty(vv, "height", { get: () => 520, configurable: true });
            Object.defineProperty(vv, "offsetTop", { get: () => 0, configurable: true });
            vv.dispatchEvent(new Event("resize"));
          });
          const campo = page.locator("#conteudo input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([disabled]):not([type=file]), #conteudo textarea").nth(1);
          if (await campo.count()) {
            await campo.focus();
            await page.waitForTimeout(900);
            await foto("4-teclado");
            m.teclado = { ...(await medir()), campo: await campo.boundingBox() };
          }
          await page.evaluate(() => {
            const vv = window.visualViewport!;
            Object.defineProperty(vv, "height", { get: () => window.innerHeight, configurable: true });
            vv.dispatchEvent(new Event("resize"));
          });
        }
        medidas[`${w}/${rota.id}`] = m;
      }
    }
    // login (sem sessão): topo e campo focado com teclado
    for (const w of larguras) {
      if (!mobile) await page.setViewportSize({ width: w, height: w >= 3000 ? 1440 : 900 });
      await page.context().clearCookies();
      await page.goto(DASH + "/login", { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
      const dir = path.join(PASTA!, String(w));
      await page.screenshot({ path: path.join(dir, "login.1-topo.png"), animations: "disabled", caret: "hide", scale: "css" });
      if (mobile) {
        await page.evaluate(() => {
          const vv = window.visualViewport!;
          Object.defineProperty(vv, "height", { get: () => 520, configurable: true });
          Object.defineProperty(vv, "offsetTop", { get: () => 0, configurable: true });
          vv.dispatchEvent(new Event("resize"));
        });
        await page.locator("#senha").focus();
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(dir, "login.4-teclado.png"), animations: "disabled", caret: "hide", scale: "css" });
      }
    }
    await entrarComo(page, "admin");
    fs.writeFileSync(path.join(PASTA!, `medidas-${info.project.name}.json`), JSON.stringify(medidas, null, 1));
  });
});
