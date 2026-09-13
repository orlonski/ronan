// Monta o Reel 3 — "O km que ele rodou é lei".
//
//   node marketing/reels/montar-reel3.mjs
//
// Três clipes do Veo (cena) + uma captura REAL do painel recusando a alteração
// de km (prova). O texto entra SOBRE o vídeo, não em cartela separada: cartela
// de tela cheia foi o que o dono reprovou na primeira tentativa, e com imagem
// de verdade embaixo ela só rouba quadro.
import { chromium } from "/Users/orlonski/dev/ronan/node_modules/@playwright/test/index.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const tmp = join(raiz, ".montagem3");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(join(raiz, "saida"), { recursive: true });

const L = 1080, A = 1920;

// A captura do painel é o último trecho. Pega a gravação mais longa (a que
// chegou até a recusa), não a primeira que o Playwright deixou na pasta.
const pastaKm = join(raiz, ".quadros", "video-km");
// Escolhe pela PROPORÇÃO, não pelo tamanho do arquivo: a pasta guarda também a
// tentativa em paisagem, que é maior em bytes e inútil aqui — um 1400x950
// escalado pra 1080 de largura dá 733 de altura e o crop pra 1920 é impossível.
const km = readdirSync(pastaKm).filter((f) => f.endsWith(".webm"))
  .map((f) => {
    const caminho = join(pastaKm, f);
    const info = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", caminho]).toString().trim().split(",");
    return { caminho, prop: Number(info[0]) / Number(info[1]) };
  })
  .filter((x) => x.prop < 0.75)
  .sort((a, b) => a.prop - b.prop)[0]?.caminho;
if (!km) throw new Error("nenhuma gravação vertical do painel em .quadros/video-km");

const SEGMENTOS = [
  { v: join(raiz, "clipes", "03a-teste.mp4"), ini: 0.4, dur: 5.4, topo: "Ele rodou 64.<br><b>Chegou 58.</b>", pe: "" },
  { v: join(raiz, "clipes", "03b.mp4"), ini: 0.6, dur: 5.6, topo: "Alguém corrigiu depois", pe: "Sem falar nada com ele" },
  { v: join(raiz, "clipes", "03c.mp4"), ini: 0.8, dur: 4.6, topo: "O km do motorista <b>é lei</b>", pe: "" },
  // A recusa acontece no fim da gravação: entra perto do fim, não do começo.
  { v: km, ini: 9.0, dur: 5.0, topo: "Mudar exige <b>motivo escrito</b>", pe: "movatruck.com.br", painel: true },
];

// ---- as camadas de texto, em PNG com transparência ----
const css = `
  * { margin:0; padding:0; box-sizing:border-box }
  @font-face { font-family:"Archivo"; src:url("instagram/fontes/archivo-800.woff2") format("woff2"); font-weight:800 }
  @font-face { font-family:"PublicSans"; src:url("instagram/fontes/public-sans-400.woff2") format("woff2"); font-weight:400 }
  html,body { width:${L}px; height:${A}px; background:transparent }
  body { display:flex; flex-direction:column; justify-content:space-between; padding:110px 60px 150px }
  .topo { font-family:"Archivo",system-ui,sans-serif; font-weight:800; font-size:78px; line-height:1.06;
          letter-spacing:-.03em; color:#fff; text-align:center;
          /* Sombra dura, não halo: o vídeo embaixo tem sol estourado e neblina,
             e texto sem contorno some no claro. */
          text-shadow:0 4px 28px rgba(0,0,0,.95), 0 2px 6px rgba(0,0,0,.9) }
  .topo b { color:#DF7234 }
  .pe { font-family:"PublicSans",system-ui,sans-serif; font-size:40px; text-align:center; color:#fff;
        text-shadow:0 3px 20px rgba(0,0,0,.95), 0 1px 4px rgba(0,0,0,.9) }
  .pe.site { color:#DF7234; font-weight:700 }
  /* O trecho do painel é uma tela CLARA. Texto branco com sombra some nela —
     então ali o texto ganha uma faixa escura da marca por trás, em vez de
     depender de contraste que não existe. */
  .painel .topo, .painel .pe { background:rgba(14,23,48,.92); padding:26px 28px; border-radius:18px }
  .painel .pe.site { color:#DF7234 }
`;

const nav = await chromium.launch();
const pg = await (await nav.newContext({ viewport: { width: L, height: A }, deviceScaleFactor: 1 })).newPage();
const camadas = [];
for (const [i, s] of SEGMENTOS.entries()) {
  const html = join(raiz, `.montagem3/t${i}.html`);
  writeFileSync(html,
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base href="file://${raiz}/">
     <style>${css}</style></head><body class="${s.painel ? "painel" : ""}">
       <div class="topo">${s.topo}</div>
       <div class="pe ${s.pe.includes("movatruck") ? "site" : ""}">${s.pe}</div>
     </body></html>`);
  await pg.goto(`file://${html}`, { waitUntil: "load" });
  await pg.evaluate(() => document.fonts.ready);
  const png = join(tmp, `t${i}.png`);
  await pg.screenshot({ path: png, omitBackground: true });
  camadas.push(png);
}
await nav.close();

// ---- cada segmento vira um mp4 de 1080x1920 com o texto queimado ----
const partes = [];
for (const [i, s] of SEGMENTOS.entries()) {
  const saida = join(tmp, `s${i}.mp4`);
  // A captura do painel é mais estreita que 9:16 e vem sem áudio; os clipes do
  // Veo já são 9:16 e trazem som nativo. `scale`+`crop` normaliza os dois, e o
  // anullsrc dá trilha muda pro que não tem, senão o concat recusa.
  const escala = s.painel
    ? `scale=${L}:-2,crop=${L}:${A}:0:0`
    : `scale=${L}:${A}:force_original_aspect_ratio=increase,crop=${L}:${A}`;
  execFileSync("ffmpeg", [
    "-y",
    "-ss", String(s.ini), "-t", String(s.dur), "-i", s.v,
    "-i", camadas[i],
    "-f", "lavfi", "-t", String(s.dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex", `[0:v]${escala},fps=30,setsar=1[v];[v][1:v]overlay=0:0,format=yuv420p[vo]`,
    "-map", "[vo]",
    "-map", s.painel ? "2:a" : "0:a?",
    "-c:v", "libx264", "-profile:v", "high", "-crf", "20",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-shortest", saida,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  partes.push(saida);
}

const lista = join(tmp, "lista.txt");
writeFileSync(lista, partes.map((p) => `file '${p}'`).join("\n") + "\n");
const final = join(raiz, "saida", "03-km-e-lei.mp4");
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", "-movflags", "+faststart", final],
  { stdio: ["ignore", "ignore", "pipe"] });

const total = SEGMENTOS.reduce((a, s) => a + s.dur, 0);
console.log(`pronto: ${final} (${total.toFixed(1)}s)`);
