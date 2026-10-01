import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, abrirRota, estabilizar, entrarComo } from "./ambiente";

/**
 * Banner "Sobre esta tela" (Leva 1, fatia 3). Perfil NOVO (localStorage vazio) em 7 telas.
 * Grava captura + altura do banner por estado. `UX_FASE=antes|depois` escolhe a pasta.
 * No celular o padrão passa a ser a linha compacta fechada; no desktop tem que ser idêntico ao de antes
 * (compare com tests/ux/comparar-dialogos.py, que também olha as pastas de banner).
 */
// Captura pesada (minutos por viewport): fora do `pnpm ux`. Rode com `pnpm ux:janelas` (UX_FASE=antes|depois).
test.beforeEach(() => test.skip(!process.env.UX_JANELAS, "captura de janelas/banner: só com UX_JANELAS=1 (pnpm ux:janelas)"));
const FASE = process.env.UX_FASE ?? "depois";
const RAIZ = path.join(__dirname, "resultados", "banner", FASE);
const TELAS = [
  { id: "motoristas", url: "/motoristas" },
  { id: "veiculos", url: "/veiculos" },
  { id: "locais", url: "/locais" },
  { id: "viagens", url: "/viagens" },
  { id: "relatorios", url: "/relatorios" },
  { id: "torre", url: "/torre" },
  { id: "programacao", url: "/programacao" },
];

async function medir(page: Page) {
  return page.evaluate(() => {
    const sec = document.querySelector('section[aria-label="Para que serve esta tela"]') as HTMLElement | null;
    const linha = Array.from(document.querySelectorAll("#conteudo button")).find((b) => /Sobre esta tela|Para que serve esta tela/.test(b.textContent ?? "")) as HTMLElement | undefined;
    const el = sec ?? linha ?? null;
    const r = el?.getBoundingClientRect();
    const h1 = document.querySelector("#conteudo h1") as HTMLElement | null;
    return {
      tipo: sec ? "cartao" : linha ? "linha" : "nenhum",
      alturaPx: r ? Math.round(r.height) : 0,
      texto: (linha?.textContent ?? "").trim(),
      tituloDaTelaY: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
      vh: window.innerHeight,
    };
  });
}

test("banner: estados por tela (perfil novo)", async ({ page }, info) => {
  test.setTimeout(400_000);
  const vp = info.project.name;
  const pasta = path.join(RAIZ, vp);
  fs.mkdirSync(pasta, { recursive: true });
  const saida: Record<string, unknown> = {};
  for (const t of TELAS) {
    await entrarComo(page, "admin");
    await page.context().clearCookies({ name: "nada" }).catch(() => {});
    await entrarComo(page, "admin");
    await abrirRota(page, { id: t.id, rotulo: t.id, url: t.url });
    const pular = page.getByRole("button", { name: "Pular" });
    if (await pular.count()) await pular.click();
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("ronan.sobre-a-tela")) localStorage.removeItem(k); });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const r: Record<string, unknown> = {};
    await estabilizar(page);
    r.padrao = await medir(page);
    await page.screenshot({ path: path.join(pasta, `${t.id}-padrao.png`), scale: "css", animations: "disabled" });
    // expandir, se o padrão for a linha compacta
    const linha = page.locator("#conteudo button", { hasText: /Sobre esta tela/ }).first();
    if (await linha.count()) {
      await linha.click();
      await page.waitForTimeout(400);
      r.expandido = await medir(page);
      await estabilizar(page);
      await page.screenshot({ path: path.join(pasta, `${t.id}-expandido.png`), scale: "css", animations: "disabled" });
      // lembra o estado: recarrega e continua expandido
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
      r.expandidoDepoisDeRecarregar = await medir(page);
    }
    // dispensar (Entendi) e recarregar: continua dispensado
    const entendi = page.getByRole("button", { name: "Entendi, fechar a explicação" });
    if (await entendi.count()) {
      await entendi.click();
      await page.waitForTimeout(300);
      r.dispensado = await medir(page);
      await estabilizar(page);
      await page.screenshot({ path: path.join(pasta, `${t.id}-dispensado.png`), scale: "css", animations: "disabled" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
      r.dispensadoDepoisDeRecarregar = await medir(page);
    }
    saida[t.id] = r;
  }
  fs.writeFileSync(path.join(RAIZ, `${vp}.json`), JSON.stringify(saida, null, 1));
  expect(Object.keys(saida).length).toBe(TELAS.length);
});
