// Gera placeholder de ícone + adaptive icon + splash usando o "R" do Ronan.
// Usar quando ainda não tem o logo definitivo. Substitui assets/* por
// PNGs com fundo azul (#1e40af) e letra R branca.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const ASSETS = resolve(PROJECT_ROOT, "assets");
if (!existsSync(ASSETS)) mkdirSync(ASSETS, { recursive: true });

const BG = "#13316b"; // brand HSL(220 75% 28%) ~ navy
const FG = "#ffffff";
const FAMILY = "system-ui, -apple-system, Helvetica, Arial, sans-serif";

function svg(size, glyph, opts = {}) {
  const fontSize = opts.fontSize ?? Math.round(size * 0.55);
  const bg = opts.bg ?? BG;
  const fg = opts.fg ?? FG;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <text x="50%" y="50%"
    font-family="${FAMILY}"
    font-size="${fontSize}"
    font-weight="700"
    fill="${fg}"
    text-anchor="middle"
    dominant-baseline="central">${glyph}</text>
</svg>`);
}

async function write(target, buffer) {
  const out = resolve(ASSETS, target);
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  await sharp(buffer).png().toFile(out);
  console.log("wrote", out);
}

async function main() {
  // 1024x1024 — ícone padrão (iOS + Android legacy)
  await write("icon.png", svg(1024, "R"));

  // Adaptive icon Android: foreground tem zona segura central (~66%) — letra menor + transparente fora
  await write(
    "adaptive-icon.png",
    Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <text x="50%" y="50%"
    font-family="${FAMILY}"
    font-size="500"
    font-weight="700"
    fill="${FG}"
    text-anchor="middle"
    dominant-baseline="central">R</text>
</svg>`),
  );

  // Splash — letra grande no centro
  await write("splash.png", svg(2732, "R", { fontSize: 800 }));

  // Favicon web (não usado em build nativo mas útil pra preview)
  await write("favicon.png", svg(48, "R", { fontSize: 32 }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
