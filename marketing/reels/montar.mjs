// Monta o Reel a partir dos recortes reais do painel.
//
// Cada quadro é uma página HTML 1080x1920 com a cartela em cima e um recorte de
// tela embaixo — o mesmo sistema visual das artes estáticas. O ffmpeg junta com
// corte seco, que é o ritmo que o playbook pede.
//
//   node marketing/reels/montar.mjs
import { chromium } from "/Users/orlonski/dev/ronan/node_modules/@playwright/test/index.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const quadros = join(raiz, ".quadros");
const tmp = join(raiz, ".montagem");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(join(raiz, "saida"), { recursive: true });

// Os números vêm da tela, não da cabeça de quem escreve. Trocar o seed muda
// estes valores — e aí o texto muda junto, nunca o contrário.
const BEATS = [
  { s: 2.4, cartela: "O motorista rodou 18 km", img: "r-faturamento.png", rodape: "Ele lançou o que rodou" },
  { s: 2.6, cartela: "O contrato paga 40", img: "r-regra.png", rodape: "Faixa 0 a 100 km · mínimo 40 km", tom: "laranja" },
  { s: 2.8, cartela: "São 22 km por viagem", img: "r-minimo.png", rodape: "O real ficou abaixo. Fatura pelo mínimo.", tom: "laranja" },
  { s: 2.8, cartela: "O km dele fica registrado", img: "r-trajeto.png", rodape: "Esta viagem: 18,0 km. Intacto." },
  { s: 3.0, cartela: "24 viagens assim no mês", img: "r-statcard.png", rodape: "O painel conta sozinho", tom: "laranja" },
  { s: 2.8, cartela: "717 rodados. <em>1.117 faturados.</em>", img: "r-statcard.png", rodape: "A diferença estava no contrato", tom: "laranja" },
  { s: 3.0, fim: true, cartela: "Faz a conta com o teu km", rodape: "movatruck.com.br" },
];

const css = `
  * { margin:0; padding:0; box-sizing:border-box }
  @font-face { font-family:"Archivo"; src:url("../instagram/fontes/archivo-800.woff2") format("woff2"); font-weight:800 }
  @font-face { font-family:"PublicSans"; src:url("../instagram/fontes/public-sans-400.woff2") format("woff2"); font-weight:400 }
  body { width:1080px; height:1920px; background:#0E1730; font-family:"PublicSans",system-ui,sans-serif;
         display:flex; flex-direction:column; overflow:hidden }
  .cartela { padding:56px 48px 36px; text-align:center }
  .cartela h1 { font-family:"Archivo",system-ui,sans-serif; font-weight:800; font-size:86px; line-height:1.04;
                letter-spacing:-.03em; color:#fff }
  .cartela h1 em { font-style:normal; color:#DF7234 }
  /* Sobre o laranja, o destaque NÃO pode ser laranja. Custou um quadro em que
     "1.117 faturados" simplesmente não existia na tela. */
  .laranja .cartela h1 em { color:#0E1730 }
  /* A imagem ocupa a LARGURA do quadro. Deixar ela "caber" dentro do palco fazia
     o recorte encolher pro meio da tela e virar ilegível no celular. */
  .palco { flex:1; display:flex; align-items:center; justify-content:center; padding:0 24px }
  .palco img { width:100%; height:auto; max-height:100%; object-fit:contain; border-radius:20px;
               box-shadow:0 50px 110px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(166,179,210,.16) }
  .rodape { padding:40px 56px 72px; text-align:center; font-size:38px; line-height:1.3; color:#A6B3D2 }
  .laranja .cartela { background:#DF7234 }
  /* O cartão final herdava a cor do body (nenhuma) e saía preto no fundo escuro.
     Cor explícita aqui — não confiar em herança em página de uma tela só. */
  .fim { align-items:center; justify-content:center; text-align:center; gap:32px; flex-direction:column }
  .fim h1 { font-family:"Archivo",system-ui,sans-serif; font-weight:800; font-size:104px;
            line-height:1.04; letter-spacing:-.03em; color:#fff }
  .fim .site { font-size:46px; color:#DF7234; font-weight:700 }
`;

const paginas = [];
BEATS.forEach((b, i) => {
  const arquivo = join(tmp, `q${String(i).padStart(2, "0")}.html`);
  const corpo = b.fim
    ? `<div class="palco fim" style="flex-direction:column">
         <h1>${b.cartela}</h1>
         <div class="site">${b.rodape}</div>
       </div>`
    : `<div class="cartela"><h1>${b.cartela}</h1></div>
       <div class="palco"><img src="../.quadros/${b.img}"></div>
       <div class="rodape">${b.rodape}</div>`;
  writeFileSync(arquivo,
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${css}</style></head>
     <body class="${b.tom === "laranja" ? "laranja" : ""}">${corpo}</body></html>`);
  paginas.push({ arquivo, png: join(tmp, `q${String(i).padStart(2, "0")}.png`), s: b.s });
});

const nav = await chromium.launch();
const pg = await (await nav.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
for (const p of paginas) {
  await pg.goto(`file://${p.arquivo}`, { waitUntil: "load" });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: p.png });
}
await nav.close();

// Corte seco: cada quadro vira N frames a 30fps. Sem fade — o playbook pede
// ritmo, e transição suave em Reel curto rouba tempo de leitura.
const lista = paginas.map((p) => `file '${p.png}'\nduration ${p.s}`).join("\n");
const arqLista = join(tmp, "lista.txt");
writeFileSync(arqLista, `${lista}\nfile '${paginas[paginas.length - 1].png}'\n`);

const saida = join(raiz, "saida", "02-km-do-contrato.mp4");
execFileSync("ffmpeg", [
  "-y", "-f", "concat", "-safe", "0", "-i", arqLista,
  // Corte seco, sem zoom. Tentei um zoompan lento e ele duplicou frames — o
  // vídeo foi de 19s pra 27s sem ninguém pedir. Ritmo aqui vem da duração de
  // cada cartela, não de movimento de câmera.
  "-vf", "fps=30,format=yuv420p",
  "-c:v", "libx264", "-profile:v", "high", "-crf", "20",
  "-movflags", "+faststart", "-an", saida,
], { stdio: ["ignore", "ignore", "pipe"] });

const total = BEATS.reduce((a, b) => a + b.s, 0);
console.log(`pronto: ${saida} (${total.toFixed(1)}s)`);
