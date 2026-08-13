import { encode } from "next-auth/jwt";
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";

const [, , viagemId, out] = process.argv;

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const login = await fetch("http://localhost:3000/admin/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "verify@schaba.com.br", senha: "verify123" }),
}).then((r) => r.json());

const cookie = await encode({
  token: { name: "Admin Verify", email: "verify@schaba.com.br", sub: "verify", accessToken: login.accessToken },
  secret: env.NEXTAUTH_SECRET,
});

const b = await chromium.launch();
// iPhone de verdade: é de onde o usuário reclamou.
const ctx = await b.newContext({ ...devices["iPhone 13"] });
await ctx.addCookies([{ name: "next-auth.session-token", value: cookie, domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.route("**/inbox/stream*", (r) => r.abort());

await p.goto(`http://localhost:3001/viagens/${viagemId}`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /Compartilhar/i }).click();
await p.waitForTimeout(900);

// O que ganhou foco ao abrir o modal? Antes era o <select> de validade.
const focado = await p.evaluate(() => {
  const el = document.activeElement;
  if (!el) return "(nenhum)";
  const rotulo = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40);
  return `${el.tagName}${el.id ? "#" + el.id : ""} [${rotulo}]`;
});
console.log("elemento focado ao abrir:", focado);

await p.screenshot({ path: `${out}/modal-mobile-aberto.png`, fullPage: true });

await p.getByRole("button", { name: /Gerar link/i }).click();
await p.waitForTimeout(1200);

// Máscara: digita só dígitos e confere o que aparece
const tel = p.locator("#tel");
await tel.fill("");
await tel.type("44999998888", { delay: 30 });
console.log("mascara com 11 digitos:", await tel.inputValue());
await tel.fill("");
await tel.type("4433334444", { delay: 30 });
console.log("mascara com 10 digitos:", await tel.inputValue());

const enviarBtn = p.getByRole("button", { name: /Enviar no WhatsApp/i });
console.log("botao enviar habilitado com 10 digitos:", !(await enviarBtn.isDisabled()));
await tel.fill("");
await tel.type("4499", { delay: 30 });
console.log("botao enviar bloqueado com 4 digitos:", await enviarBtn.isDisabled());
await tel.fill("");
await tel.type("44999998888", { delay: 30 });

await p.screenshot({ path: `${out}/modal-mobile-mascara.png`, fullPage: true });
await b.close();
