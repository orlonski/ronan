// Exporta cada página do documento como PNG pra conferência visual.
import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 1.4 });
await p.goto("file:///Users/orlonski/dev/ronan/proposta-alex/proposta.html", { waitUntil: "networkidle" });
const n = await p.locator(".page").count();
for (let i = 0; i < n; i++) {
  await p.locator(".page").nth(i).screenshot({ path: `/private/tmp/claude-501/-Users-orlonski-dev-ronan/105fd308-bb24-41c8-87e2-bf95dddbe800/scratchpad/pg-${String(i+1).padStart(2,"0")}.png` });
}
console.log(n + " páginas exportadas");
await b.close();
