// Dirige a tela de Relatórios autenticada de verdade (API local real).
// Rodar de dentro de apps/dashboard: node .shot-relatorios.mjs
import { readFileSync } from "node:fs";
import { encode } from "next-auth/jwt";
import { chromium } from "@playwright/test";

const OUT = "/private/tmp/claude-501/-Users-orlonski-dev-ronan/ee9069af-5cdf-49fc-ade6-33426c47430c/scratchpad";
const env = readFileSync(".env", "utf8");
const secret = /NEXTAUTH_SECRET=(.+)/.exec(env)[1].trim();

async function login(email) {
  const r = await fetch("http://localhost:3000/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, senha: "admin123" }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`login falhou p/ ${email}: ${JSON.stringify(j)}`);
  return j.accessToken;
}

async function abrir(browser, email, nome) {
  const accessToken = await login(email);
  const cookie = await encode({
    token: { name: nome, email, sub: "x", accessToken },
    secret,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([
    { name: "next-auth.session-token", value: cookie, domain: "localhost", path: "/" },
  ]);
  const page = await ctx.newPage();
  await page.route("**/inbox/stream*", (r) => r.abort());

  // Capturar TODA requisição >=400: um 403 de fundo não aparece na tela.
  const falhas = [];
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("inbox/stream")) {
      falhas.push(`${res.status()} ${res.url().replace("http://localhost:3000", "")}`);
    }
  });
  return { page, falhas, ctx };
}

const browser = await chromium.launch();

// ---------- 1. Admin completo ----------
{
  const { page, falhas } = await abrir(browser, "relt@schaba.com.br", "Admin Relatorio");
  await page.goto("http://localhost:3001/relatorios/viagens?de=2026-07-01&ate=2026-07-31");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  const corpo = await page.locator("body").innerText();
  console.log("== ADMIN / agrupado por motorista ==");
  console.log("Tem 'Joao da Silva':", corpo.includes("Joao da Silva"));
  console.log("Tem coluna 'Ton. faturada':", corpo.includes("Ton. faturada"));
  console.log("Tem aviso de reconciliação:", corpo.includes("não somar ao total"));
  console.log("Tem botões de export:", corpo.includes("Excel") && corpo.includes("PDF"));
  console.log("Botões de dimensão comercial visíveis:", corpo.includes("Cliente") && corpo.includes("Empresa"));
  await page.screenshot({ path: `${OUT}/tela-1-motorista.png`, fullPage: true });

  // Trocar agrupamento pra Material
  // .first() = o botão de AGRUPAR; o .nth(1) é o combobox de filtro homônimo.
  await page.getByRole("button", { name: "Material", exact: true }).first().click();
  await page.waitForTimeout(1500);
  const corpo2 = await page.locator("body").innerText();
  console.log("Após clicar em Material — tem 'Areia RELT':", corpo2.includes("Areia RELT"));
  await page.screenshot({ path: `${OUT}/tela-2-material.png`, fullPage: true });

  // Preset "Mês passado"
  await page.getByRole("button", { name: "Mês passado" }).click();
  await page.waitForTimeout(1200);
  const deVal = await page.locator('input[type="date"]').first().inputValue();
  console.log("Preset 'Mês passado' setou de =", deVal);

  // Voltar pro período do seed e abrir o drill-down
  await page.goto("http://localhost:3001/relatorios/viagens?de=2026-07-01&ate=2026-07-31");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await page.getByText("Joao da Silva").first().click();
  await page.waitForTimeout(1800);
  const sheet = await page.locator('[role="dialog"]').innerText().catch(() => "");
  console.log("\n== DRILL-DOWN de Joao da Silva ==");
  console.log(sheet.split("\n").slice(0, 12).join(" | "));
  const linhasSheet = await page.locator('[role="dialog"] tbody tr').count();
  console.log("linhas na tabela do drawer:", linhasSheet, "(resumo diz 4 viagens)");
  console.log("Não traz a viagem sem peso:", !sheet.includes("SEMPESO"));
  await page.screenshot({ path: `${OUT}/tela-3-drilldown.png` });

  console.log("\nXHR com erro (admin):", falhas.length ? falhas : "nenhum");
}

// ---------- 2. Usuário SEM ver-comercial ----------
{
  const { page, falhas } = await abrir(browser, "relt-frota@schaba.com.br", "Gestor Frota");
  await page.goto("http://localhost:3001/relatorios/viagens?de=2026-07-01&ate=2026-07-31");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1800);
  const corpo = await page.locator("body").innerText();
  console.log("\n== SEM ver-comercial ==");
  console.log("Abre a tela:", corpo.includes("Relatórios"));
  console.log("NÃO tem coluna 'Ton. faturada':", !corpo.includes("Ton. faturada"));
  console.log("NÃO oferece agrupar por Cliente:", !corpo.includes("Cliente"));
  console.log("NÃO oferece agrupar por Empresa:", !corpo.includes("Empresa"));
  console.log("Ainda mostra produção:", corpo.includes("Viagens") && corpo.includes("Toneladas"));
  await page.screenshot({ path: `${OUT}/tela-4-sem-comercial.png`, fullPage: true });
  console.log("XHR com erro (sem comercial):", falhas.length ? falhas : "nenhum");
}

await browser.close();
