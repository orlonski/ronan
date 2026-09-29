import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import type { Rota } from "./rotas";

/**
 * Ambiente da suíte de UX: sessão do admin do seed, rede travada (só localhost, só leitura),
 * relógio congelado e helpers de "tela pronta" e de estabilização pra screenshot.
 */
export const API = process.env.UX_API ?? "http://localhost:3100";
export const DASH = process.env.UX_DASH ?? "http://localhost:3101";
const SECRET = process.env.UX_NEXTAUTH_SECRET ?? "ux-medidas-nextauth-secret";
/** Mesmo "agora" que tests/ux/stack/fixar-data.cjs dá pra API e pro painel. */
export const AGORA_FIXO = process.env.UX_ANCHOR ?? "2026-09-29T15:00:00Z";

const RAIZ = path.resolve(__dirname, "../..");
// next-auth só existe em apps/dashboard/node_modules
const reqDash = createRequire(path.join(RAIZ, "apps/dashboard/package.json"));
const { encode } = reqDash("next-auth/jwt") as {
  encode: (p: { token: Record<string, unknown>; secret: string }) => Promise<string>;
};

function idsDoSeed(): { adminEmail: string; superEmail: string; operadorEmail: string; senha: string } {
  const f = path.join(__dirname, ".stack", "seed-ids.json");
  if (!fs.existsSync(f)) {
    throw new Error("Sem tests/ux/.stack/seed-ids.json: suba o stack antes (tests/ux/subir-stack.sh subir).");
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

type Cookie = { name: string; value: string; domain: string; path: string; httpOnly: boolean; sameSite: "Lax" };
const cookies: Partial<Record<"admin" | "super" | "operador", Promise<Cookie>>> = {};
/** `admin` = administrador da empresa do seed; `operador` = papel restrito (viagens/motoristas/veículos/locais); `super` = super admin da plataforma (telas só da Movatruck, ex. /whatsapp). */
function cookieDe(quem: "admin" | "super" | "operador"): Promise<Cookie> {
  return (cookies[quem] ??= (async () => {
    const ids = idsDoSeed();
    const adminEmail = quem === "super" ? ids.superEmail : quem === "operador" ? ids.operadorEmail : ids.adminEmail;
    const senha = ids.senha;
    const r = await fetch(`${API}/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail, senha }),
    });
    if (!r.ok) throw new Error(`login do admin do seed falhou (${r.status}) em ${API}. O stack está de pé?`);
    const t = (await r.json()) as { accessToken: string; refreshToken: string };
    const exp = JSON.parse(Buffer.from(t.accessToken.split(".")[1]!, "base64url").toString()).exp as number;
    const value = await encode({
      token: { name: adminEmail, email: adminEmail, sub: adminEmail, accessToken: t.accessToken, refreshToken: t.refreshToken, accessTokenExpires: exp * 1000 },
      secret: SECRET,
    });
    return { name: "next-auth.session-token", value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" as const };
  })());
}

/** Loga o contexto como outro usuário do seed (o cookie do admin é trocado). */
export async function entrarComo(page: Page, quem: "admin" | "super" | "operador"): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies([await cookieDe(quem)]);
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addCookies([await cookieDe("admin")]);
    // Relógio do navegador congelado no mesmo dia do seed (a API e o painel usam fixar-data.cjs).
    await context.clock.setFixedTime(new Date(AGORA_FIXO));
    // Nada sai da máquina e nada é escrito: só localhost e só leitura.
    await context.route("**/*", (route) => {
      const rq = route.request();
      const u = new URL(rq.url());
      if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return route.abort();
      if (/\/inbox\/stream/.test(u.pathname)) return route.abort(); // SSE: nunca "termina"
      const m = rq.method();
      const mutacao = m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
      if (mutacao && !u.pathname.startsWith("/api/auth/")) return route.abort();
      return route.continue();
    });
    await use(context);
  },
});
export { expect };

const RESTRITO = /Você não tem acesso|não está ativo na sua empresa|Fale com a Movatruck pra ativar|não contratou/;

/** Abre a rota e espera a tela de verdade (sem "Carregando…", rede quieta). */
export async function abrirRota(page: Page, rota: Rota): Promise<void> {
  if (rota.usuario === "super") await page.context().addCookies([await cookieDe("super")]);
  const resp = await page.goto(DASH + rota.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  expect(resp?.status(), `HTTP de ${rota.url}`).toBeLessThan(400);
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await page
    .waitForFunction(() => !/Carregando…|Carregando\.\.\./.test((document.getElementById("conteudo") ?? document.body).innerText.slice(0, 2000)), null, { timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(700);
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  const url = new URL(page.url());
  expect(url.pathname, `redirecionou pra fora de ${rota.url} (sessão caiu?)`).not.toBe("/login");
  const texto = await page.evaluate(() => (document.getElementById("conteudo") ?? document.body).innerText);
  expect(RESTRITO.test(texto), `${rota.url} caiu em tela de acesso restrito`).toBe(false);
  // Teste de sanidade da trava: UX_SABOTAR=1 estoura o layout de propósito.
  if (process.env.UX_SABOTAR) {
    // UX_SABOTAR=1: estoura a largura (pega o orçamento). UX_SABOTAR=estreito: espreme o conteúdo (pega o screenshot).
    const css = process.env.UX_SABOTAR === "estreito" ? "#conteudo{padding-left:400px !important}" : "#conteudo{width:4000px !important;min-width:4000px !important}";
    await page.addStyleTag({ content: css });
    await page.waitForTimeout(300);
  }
}

/**
 * Deixa a tela reprodutível pra screenshot: para animações e foco, e troca por marcador fixo o
 * que muda a cada execução (horas, "há N min"). Datas de calendário NÃO mudam: o relógio está
 * congelado no dia do seed, então "hoje" é sempre o mesmo dia.
 */
export async function estabilizar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ativo = document.activeElement as HTMLElement | null;
    ativo?.blur?.();
    const rel = /\bhá (?:cerca de )?\d+\s*(?:s|seg\w*|min\w*|h|horas?|d|dias?)\b/gi;
    const hora = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(p.tagName)) continue;
      const v = n.nodeValue ?? "";
      const nv = v.replace(rel, "há 0 min").replace(hora, "00:00");
      if (nv !== v) n.nodeValue = nv;
    }
  });
  await page.waitForTimeout(150);
}
