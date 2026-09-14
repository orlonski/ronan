// Monta um Reel mudo a partir de clipes + cartelas.
//
//   node marketing/reels/montar.mjs <roteiro.json>
//
// O roteiro é um JSON com a lista de trechos:
//   { "saida": "04-papel.mp4",
//     "trechos": [ { "clipe": "clipes/x.mp4", "ini": 0.2, "dur": 5.6,
//                    "texto": "ESSE PAPEL É O <b>PAGAMENTO</b> DELE",
//                    "pe": "opcional" } ],
//     "fecho": { "dur": 2.0, "texto": "MOVATRUCK", "pe": "movatruck.com.br" } }
//
// Substituiu o montar.mjs antigo, que empilhava cartela de tela cheia sobre
// recorte de painel — formato reprovado. Aqui o texto entra POR CIMA da imagem,
// e o fecho é tipográfico, sem tela de produto.
//
// MUDO DE PROPÓSITO: o Hailuo não gera áudio, e a pesquisa não sustenta
// penalidade pra Reel sem som — cerca de 60% assiste com o som desligado. Todo
// o peso narrativo está no texto e no corte.
import { chromium } from "/Users/orlonski/dev/ronan/node_modules/@playwright/test/index.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const arquivoRoteiro = process.argv[2];
if (!arquivoRoteiro) { console.error("uso: node montar.mjs <roteiro.json>"); process.exit(1); }
const roteiro = JSON.parse(readFileSync(arquivoRoteiro, "utf8"));

const tmp = join(raiz, ".montagem");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(join(raiz, "saida"), { recursive: true });

const L = 1080, A = 1920;
const caminho = (p) => (isAbsolute(p) ? p : join(raiz, p));

const css = `
  * { margin:0; padding:0; box-sizing:border-box }
  @font-face { font-family:"Archivo"; src:url("instagram/fontes/archivo-800.woff2") format("woff2"); font-weight:800 }
  @font-face { font-family:"PublicSans"; src:url("instagram/fontes/public-sans-400.woff2") format("woff2"); font-weight:400 }
  html,body { width:${L}px; height:${A}px; background:transparent }
  body { display:flex; flex-direction:column; justify-content:space-between; padding:120px 56px 160px }
  .texto { font-family:"Archivo",system-ui,sans-serif; font-weight:800; font-size:84px; line-height:1.04;
           letter-spacing:-.03em; color:#fff; text-align:center;
           /* Contorno duro, não brilho: a imagem embaixo tem céu branco estourado
              e metal molhado, e texto sem borda some no claro. */
           text-shadow:0 0 3px rgba(0,0,0,.9), 0 4px 30px rgba(0,0,0,.95), 0 2px 6px rgba(0,0,0,.95) }
  .texto b { color:#DF7234 }
  .pe { font-family:"PublicSans",system-ui,sans-serif; font-size:42px; text-align:center; color:#fff;
        text-shadow:0 0 3px rgba(0,0,0,.9), 0 3px 22px rgba(0,0,0,.95) }
  .fecho { justify-content:center; gap:34px }
  .fecho .texto { font-size:110px }
  .fecho .pe { color:#DF7234; font-weight:700 }
`;

const nav = await chromium.launch();
const pg = await (await nav.newContext({ viewport: { width: L, height: A }, deviceScaleFactor: 1 })).newPage();
async function camada(i, texto, pe, fecho) {
  const html = join(tmp, `t${i}.html`);
  writeFileSync(html,
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base href="file://${raiz}/">
     <style>${css}</style></head><body class="${fecho ? "fecho" : ""}">
       <div class="texto">${texto ?? ""}</div>
       <div class="pe">${pe ?? ""}</div>
     </body></html>`);
  await pg.goto(`file://${html}`, { waitUntil: "load" });
  await pg.evaluate(() => document.fonts.ready);
  const png = join(tmp, `t${i}.png`);
  await pg.screenshot({ path: png, omitBackground: true });
  return png;
}

const partes = [];
for (const [i, t] of roteiro.trechos.entries()) {
  const png = await camada(i, t.texto, t.pe, false);
  const saida = join(tmp, `s${i}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-ss", String(t.ini ?? 0), "-t", String(t.dur), "-i", caminho(t.clipe),
    "-i", png,
    "-filter_complex",
    `[0:v]scale=${L}:${A}:force_original_aspect_ratio=increase,crop=${L}:${A},fps=30,setsar=1[v];` +
    `[v][1:v]overlay=0:0,format=yuv420p[vo]`,
    "-map", "[vo]", "-an",
    "-c:v", "libx264", "-profile:v", "high", "-crf", "20", saida,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  partes.push(saida);
}

// Fecho tipográfico sobre o último quadro escurecido — nunca cartela branca de
// tela cheia, e nunca tela de produto.
if (roteiro.fecho) {
  const png = await camada("f", roteiro.fecho.texto, roteiro.fecho.pe, true);
  const ultimo = roteiro.trechos[roteiro.trechos.length - 1];
  const saida = join(tmp, "sf.mp4");
  execFileSync("ffmpeg", [
    "-y", "-ss", String((ultimo.ini ?? 0) + ultimo.dur - 0.4), "-t", String(roteiro.fecho.dur),
    "-i", caminho(ultimo.clipe), "-i", png,
    "-filter_complex",
    `[0:v]scale=${L}:${A}:force_original_aspect_ratio=increase,crop=${L}:${A},fps=30,setsar=1,` +
    `eq=brightness=-0.28:saturation=0.5[v];[v][1:v]overlay=0:0,format=yuv420p[vo]`,
    "-map", "[vo]", "-an",
    "-c:v", "libx264", "-profile:v", "high", "-crf", "20", saida,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  partes.push(saida);
}
await nav.close();

const lista = join(tmp, "lista.txt");
writeFileSync(lista, partes.map((p) => `file '${p}'`).join("\n") + "\n");
const final = join(raiz, "saida", roteiro.saida);
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", "-movflags", "+faststart", final],
  { stdio: ["ignore", "ignore", "pipe"] });

const total = roteiro.trechos.reduce((a, t) => a + t.dur, 0) + (roteiro.fecho?.dur ?? 0);
console.log(`pronto: ${final} (${total.toFixed(1)}s)`);
