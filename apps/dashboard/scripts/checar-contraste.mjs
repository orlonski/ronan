/**
 * Contraste dos temas do painel (WCAG 2.2 AA, 4.5:1 pra texto).
 *
 * O painel oferece dez temas e é usado oito horas por dia. Antes desta
 * verificação, seis deles reprovavam no texto do botão "Salvar" e quatro no
 * cinza de toda legenda — e ninguém tinha como saber sem medir.
 *
 * Rode com `pnpm --filter @ronan/dashboard contraste`.
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const lum = (hex) => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  const [x, y] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (x + 0.05) / (y + 0.05);
};

/** Pares texto→fundo que o painel realmente desenha. */
const PARES = [
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "sidebar"],
  ["foreground", "background"],
  ["primary-foreground", "primary"],
  ["destructive-foreground", "destructive"],
  ["accent-foreground", "accent"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["secondary-foreground", "secondary"],
];

let falhas = 0;
for (const m of css.matchAll(/([^{}]+)\{([^{}]*--background[^{}]*)\}/g)) {
  const tema = m[1].split("*/").pop().trim().replace(/\s+/g, " ");
  const vars = {};
  for (const v of m[2].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) vars[v[1]] = v[2];
  if (!vars.background) continue;
  for (const [fg, bg] of PARES) {
    if (!vars[fg] || !vars[bg]) continue;
    const r = cr(vars[fg], vars[bg]);
    if (r < 4.5) {
      falhas++;
      console.error(`FALHA  ${tema}: --${fg} (${vars[fg]}) sobre --${bg} (${vars[bg]}) = ${r.toFixed(2)}:1`);
    }
  }
}

if (falhas > 0) {
  console.error(`\n${falhas} par(es) de cor abaixo de 4.5:1.`);
  process.exit(1);
}
console.log("Contraste: todos os temas passam em AA (4.5:1).");
