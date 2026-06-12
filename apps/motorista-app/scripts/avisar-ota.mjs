#!/usr/bin/env node
/**
 * Avisa os motoristas (push) que saiu uma versão nova — chamado logo após
 * `eas update`. NÃO é cron: dispara só quando você publica.
 *
 * Lê de env:
 *   OTA_NOTIFY_URL    (default: API de produção)
 *   OTA_NOTIFY_SECRET (obrigatório; mesmo valor de DEPLOY_NOTIFY_SECRET na API)
 *
 * Falha aqui NUNCA derruba o publish (sai com código 0) — o OTA já foi.
 */
const url =
  process.env.OTA_NOTIFY_URL ??
  "https://ronan-api.2azr6q.easypanel.host/app/deploy/nova-versao";
const secret = process.env.OTA_NOTIFY_SECRET;

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
