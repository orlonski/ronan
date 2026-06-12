#!/usr/bin/env node
/**
 * Avisa os motoristas (push) que saiu uma versão nova — chamado logo após
 * `eas update`. NÃO é cron: dispara só quando você publica.
 *
 * Lê OTA_NOTIFY_URL / OTA_NOTIFY_SECRET do ambiente OU do `.env.local`
 * (gitignored) deste app — então `pnpm ota` funciona sem exportar nada.
 * OTA_NOTIFY_SECRET deve ser igual ao DEPLOY_NOTIFY_SECRET da API.
 *
 * Falha aqui NUNCA derruba o publish (sai com código 0) — o OTA já foi.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Lê chaves do .env.local sem dep externa (KEY=VALUE, ignora #/vazias). */
function lerEnvLocal() {
  try {
    const arquivo = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
    const out = {};
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...lerEnvLocal(), ...process.env };
const url =
  env.OTA_NOTIFY_URL ?? "https://ronan-api.2azr6q.easypanel.host/app/deploy/nova-versao";
const secret = env.OTA_NOTIFY_SECRET;

if (!secret) {
  console.warn("⚠️  OTA_NOTIFY_SECRET não definido — pulei o aviso aos motoristas.");
  process.exit(0);
}

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-deploy-secret": secret },
  });
  if (!res.ok) {
    console.warn(`⚠️  Aviso aos motoristas falhou (HTTP ${res.status}). OTA publicado mesmo assim.`);
    process.exit(0);
  }
  const json = await res.json().catch(() => ({}));
  console.log(`✅ Motoristas avisados: ${json.avisados ?? "?"}`);
} catch (e) {
  console.warn(`⚠️  Aviso aos motoristas falhou (${String(e)}). OTA publicado mesmo assim.`);
}
process.exit(0);
