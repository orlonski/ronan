// Confere estouro de conteúdo em cada página A4 de altura fixa.
import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 1600 } });
await p.goto("file:///Users/orlonski/dev/ronan/proposta-alex/proposta.html", { waitUntil: "networkidle" });
const r = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll(".page").forEach((el, i) => {
    const foot = el.querySelector(".pfoot");
    const limite = foot ? foot.offsetTop : el.clientHeight;
    let maxBottom = 0, culpado = "";
    el.querySelectorAll(":scope > *:not(.phead):not(.pfoot)").forEach((c) => {
      const bottom = c.offsetTop + c.offsetHeight;
      if (bottom > maxBottom) { maxBottom = bottom; culpado = c.tagName + "." + (c.className || "").split(" ")[0]; }
    });
    out.push({ pag: i + 1, altura: el.scrollHeight, limite: Math.round(limite), fim: Math.round(maxBottom), folga: Math.round(limite - maxBottom), culpado });
  });
  return out;
});
for (const x of r) {
  const flag = x.folga < 0 ? "  ❌ ESTOUROU" : x.folga < 12 ? "  ⚠︎ apertado" : "";
  console.log(`pág ${String(x.pag).padStart(2)}  folga ${String(x.folga).padStart(5)}px  (${x.culpado})${flag}`);
}
await b.close();
