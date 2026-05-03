// Gera assets (icone do app, adaptive icon Android, splash, favicon).
// Logo placeholder com cara de "transporte" — bloco RONAN + barra horizontal.
// Substitui assets/* por PNGs com fundo brand (#13316b) e elementos brancos.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const ASSETS = resolve(PROJECT_ROOT, "assets");
if (!existsSync(ASSETS)) mkdirSync(ASSETS, { recursive: true });

const BG = "#13316b"; // brand
const FG = "#ffffff";
const ACCENT = "#ea580c"; // primary (laranja construção)
const FAMILY = "system-ui, -apple-system, Helvetica, Arial, sans-serif";

/** Letra R bold centrada (pra app icon). */
function svgIcon(size, opts = {}) {
  const { bg = BG, fg = FG, withAccent = true } = opts;
  const radius = Math.round(size * 0.18);
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="round">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect width="${size}" height="${size}" fill="${bg}"/>
    ${
      withAccent
        ? `<rect x="0" y="${size - Math.round(size * 0.08)}" width="${size}" height="${Math.round(size * 0.08)}" fill="${ACCENT}"/>`
        : ""
    }
    <text x="50%" y="46%"
      font-family="${FAMILY}"
      font-size="${Math.round(size * 0.6)}"
      font-weight="900"
      fill="${fg}"
      text-anchor="middle"
      dominant-baseline="central"
      letter-spacing="-2">R</text>
  </g>
</svg>`);
}

/** Adaptive icon foreground (Android): centro safe zone ~66%, sem fundo (brand vai no backgroundColor). */
function svgAdaptive(size) {
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <text x="50%" y="50%"
    font-family="${FAMILY}"
    font-size="${Math.round(size * 0.45)}"
    font-weight="900"
    fill="${FG}"
    text-anchor="middle"
    dominant-baseline="central"
    letter-spacing="-2">R</text>
</svg>`);
}

/** Splash: logo "RONAN" centrada com barra accent embaixo. */
function svgSplash(size) {
  const txtSize = Math.round(size * 0.14);
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="50%" y="48%"
    font-family="${FAMILY}"
    font-size="${txtSize}"
    font-weight="900"
    fill="${FG}"
    text-anchor="middle"
    dominant-baseline="central"
    letter-spacing="${Math.round(txtSize * 0.05)}">RONAN</text>
  <rect x="${size * 0.4}" y="${size * 0.55}" width="${size * 0.2}" height="${Math.max(8, Math.round(size * 0.012))}" rx="2" fill="${ACCENT}"/>
  <text x="50%" y="60%"
    font-family="${FAMILY}"
    font-size="${Math.round(size * 0.026)}"
    font-weight="600"
    fill="${FG}"
    fill-opacity="0.7"
    text-anchor="middle"
    dominant-baseline="central"
    letter-spacing="${Math.round(size * 0.005)}">MOTORISTA</text>
</svg>`);
}

async function write(target, buffer) {
  const out = resolve(ASSETS, target);
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  await sharp(buffer).png().toFile(out);
  console.log("wrote", out);
}

async function main() {
  await write("icon.png", svgIcon(1024));
  await write("adaptive-icon.png", svgAdaptive(1024));
  await write("splash.png", svgSplash(2732));
  await write("favicon.png", svgIcon(48, { withAccent: false }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
