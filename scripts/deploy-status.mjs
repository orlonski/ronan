#!/usr/bin/env node
/**
 * O que está no ar, comparado com o que está aqui.
 *
 * Existe porque o Easypanel não derruba o container antigo: os serviços seguem
 * verdes e respondendo 200 mesmo quando o build morreu atropelado, e o amarelo
 * fica só no histórico de implantação. Olhar a cor da tela não responde "a minha
 * última mudança subiu?" — isto responde.
 */
const API = process.env.API_URL ?? "https://api.schaba.com.br";
const PAINEL = process.env.PAINEL_URL ?? "https://app.movatruck.com.br";

export async function saude(base = API, timeoutMs = 12_000) {
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { signal: controle.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Rede ruim não é deploy quebrado. Quem chama decide o que fazer com null.
    return null;
  } finally {
    clearTimeout(t);
  }
}

function minutosDesde(iso) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

async function main() {
  const s = await saude();
  if (!s) {
    console.log("API fora de alcance. Sem rede, ou ela está mesmo caída.");
    process.exit(2);
  }

  console.log(`API        ${s.status} · banco ${s.db}`);
  console.log(`Migration  ${s.migracao}`);
  console.log(`No ar há   ${minutosDesde(s.iniciadoEm)} min (subiu ${new Date(s.iniciadoEm).toLocaleString("pt-BR")})`);

  const res = await fetch(`${PAINEL}/`, { redirect: "manual" }).catch(() => null);
  console.log(`Painel     ${res ? `HTTP ${res.status}` : "fora de alcance"}`);

  console.log(
    "\nPra saber se um commit específico subiu, bata numa rota que só existe nele:\n" +
      "  401 = a rota existe (subiu) · 404 = não subiu",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
