// Telas do app do motorista (PWA iPhone) pra proposta comercial.
import { chromium, devices } from "@playwright/test";
const OUT = "/Users/orlonski/dev/ronan/proposta-alex/imagens";
const APP = "http://localhost:3002";
const CPF = process.env.CPF;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["iPhone 13"], deviceScaleFactor: 3, locale: "pt-BR", timezoneId: "America/Sao_Paulo",
  permissions: ["geolocation"], geolocation: { latitude: -25.4589, longitude: -49.528 },
});
const page = await ctx.newPage();
page.on("request", (r) => { if (r.url().includes("/m/")) console.log("  →", r.method(), r.url()); });
page.on("console", (m) => { if (m.type() === "error") console.log("  js:", m.text().slice(0, 120)); });

await page.goto(APP + "/login", { waitUntil: "networkidle" });
await page.click("#cpf");
await page.locator("#cpf").pressSequentially(CPF, { delay: 40 });
await page.click("#senha");
await page.locator("#senha").pressSequentially("demo1234", { delay: 40 });
console.log("cpf digitado:", await page.locator("#cpf").inputValue());
await page.getByRole("button", { name: /entrar/i }).click();
await page.waitForTimeout(7000);
console.log("url pós-login:", page.url());
const err = await page.locator(".text-destructive").first().textContent().catch(() => null);
if (err) console.log("erro na tela:", err);

// tira o convite de instalação (traz a marca do cliente atual) de todas as telas
const limpar = async () => {
  await page.evaluate(() => {
    const alvos = [...document.querySelectorAll("div,section,aside")]
      .filter((el) => /Instale o .{0,30} na tela inicial/.test(el.textContent || ""));
    if (!alvos.length) return;
    // o último em ordem de documento é o mais profundo que contém o texto
    let node = alvos[alvos.length - 1];
    // sobe enquanto o pai não tiver mais nada além do banner
    while (node.parentElement && node.parentElement.textContent.trim() === node.textContent.trim()) {
      node = node.parentElement;
    }
    node.remove();
  }).catch(() => {});
};

const shot = async (nome, url, ms = 3000) => {
  if (url) await page.goto(APP + url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(ms);
  await limpar();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${nome}.png` });
  console.log(`✓ ${nome}  ${url ?? page.url()}`);
};

await shot("20-app-home", "/", 4000);
await shot("21-app-nova-viagem", "/nova-viagem", 4000);
await shot("22-app-historico", "/historico", 3000);
await shot("23-app-pendentes", "/pendentes", 2500);
await shot("24-app-perfil", "/perfil", 2500);

await browser.close();
console.log("fim");
