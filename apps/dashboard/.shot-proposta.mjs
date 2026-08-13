// Captura as telas do painel pra proposta comercial. Roda de dentro de
// apps/dashboard (resolve o next-auth v4 do repo). Sessão forjada: o layout do
// painel só checa se existe sessão; o accessToken de dentro é o que vai na API.
import { readFileSync } from "node:fs";
import { encode } from "next-auth/jwt";
import { chromium } from "@playwright/test";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const OUT = "/Users/orlonski/dev/ronan/proposta-alex/imagens";
const API = "http://localhost:3000";
const APP = "http://localhost:3001";

const IDS = {
  viagem: process.env.VIAGEM_ID,
  fechamento: process.env.FECHAMENTO_ID,
  empresa: process.env.EMPRESA_ID,
  motorista: process.env.MOTORISTA_ID,
};

const login = await (await fetch(`${API}/admin/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@ronan.local", senha: "demo1234" }),
})).json();
if (!login.accessToken) throw new Error("login falhou: " + JSON.stringify(login));

const cookie = await encode({
  token: {
    name: "Marcos Andrade", email: "admin@ronan.local", sub: "demo",
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
    // sem isso o callback jwt tenta rotacionar a cada request e mata a sessão
    accessTokenExpires: JSON.parse(Buffer.from(login.accessToken.split(".")[1], "base64").toString()).exp * 1000,
  },
  secret: env.NEXTAUTH_SECRET,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 940 },
  deviceScaleFactor: 2,
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
await ctx.addCookies([{ name: "next-auth.session-token", value: cookie, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
await page.route("**/inbox/stream*", (r) => r.abort());

// troca o logo por um wordmark neutro (a marca do cliente atual não vai no PDF)
const neutralizar = async () => {
  await page.addStyleTag({ content: `
    [role="img"][aria-label="Schaba"]{ -webkit-mask-image:none!important; mask-image:none!important;
      background:transparent!important; position:relative; }
    [role="img"][aria-label="Schaba"]::after{
      content:"GESTÃO DE VIAGENS"; position:absolute; inset:0; display:flex; align-items:center;
      font: 700 13px/1 -apple-system,Helvetica,Arial,sans-serif; letter-spacing:.14em;
      color: currentColor; white-space:nowrap; }
  ` });
};

const shot = async (nome, url, opts = {}) => {
  await page.goto(APP + url, { waitUntil: "networkidle", timeout: 60000 });
  await neutralizar();
  if (opts.texto) await page.getByText(opts.texto).first().waitFor({ timeout: 25000 }).catch(() => console.log("  (texto nao apareceu: " + opts.texto + ")"));
  if (opts.espera) await page.waitForTimeout(opts.espera);
  if (opts.seletor) await page.waitForSelector(opts.seletor, { timeout: 15000 }).catch(() => {});
  if (opts.clicar) { await page.getByRole("tab", { name: opts.clicar }).first().click().catch(async () => { await page.getByText(opts.clicar).first().click().catch(() => {}); }); await page.waitForTimeout(1800); }
  if (opts.rolar) await page.evaluate((y) => window.scrollTo(0, y), opts.rolar);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${nome}.png`, fullPage: !!opts.full });
  const t = await page.title();
  console.log(`✓ ${nome}  ${url}  [${t}]`);
};

await shot("01-painel-home", "/", { texto: /Hoje/, espera: 3500 });
await shot("02-viagens-lista", "/viagens", { espera: 2000 });
await shot("03-viagem-detalhe", `/viagens/${IDS.viagem}`, { espera: 3500 });
await shot("04-viagem-detalhe-mapa", `/viagens/${IDS.viagem}`, { espera: 3500, rolar: 900 });
await shot("05-viagens-andamento", "/viagens-andamento", { espera: 2000 });
await shot("06-conciliacao", `/fechamentos/${IDS.fechamento}`, { espera: 3000 });
await shot("06b-conciliacao-conferencia", `/fechamentos/${IDS.fechamento}`, { espera: 2500, clicar: /Confer\u00eancia/ });
await shot("06c-conciliacao-linhas", `/fechamentos/${IDS.fechamento}`, { espera: 2500, clicar: /^Linhas$/ });
await shot("07-layout-envio", `/empresas/${IDS.empresa}/layout-envio`, { espera: 2500 });
await shot("08-permissoes", "/configuracoes/permissoes", { espera: 2500 });
await shot("09-mapa-frota", "/mapa", { espera: 4000 });
await shot("10-motorista-acessos", `/motoristas/${IDS.motorista}`, { espera: 2500, rolar: 980 });
await shot("11-regras-minimo", "/regras-minimo", { espera: 2000 });
await shot("12-locais-validacao", "/locais/em-validacao", { espera: 2000 });
await shot("13-abastecimentos", "/abastecimentos", { espera: 2000 });
await shot("14-diagnosticos", "/configuracoes/km-atipico", { espera: 2000 });

await browser.close();
console.log("fim");
