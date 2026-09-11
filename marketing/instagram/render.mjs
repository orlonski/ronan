// Renderiza as peças HTML em PNG 1080x1350 @2x, prontas pro Instagram.
//   node render.mjs        -> renderiza tudo
//   node render.mjs 03     -> só a peça que começa com "03"
import { chromium } from "@playwright/test";
import { readdir, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const raiz = dirname(fileURLToPath(import.meta.url));
const filtro = process.argv[2];

const pasta = process.env.PASTA || "posts";

const arquivos = (await readdir(join(raiz, pasta)))
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !filtro || f.startsWith(filtro))
  .sort();

if (!arquivos.length) {
  console.error(filtro ? `Nenhuma peça começando com "${filtro}".` : `Nenhuma peça em ${pasta}/.`);
  process.exit(1);
}

await mkdir(join(raiz, "saida"), { recursive: true });
// A API de publicação do Instagram não aceita PNG e reduz qualquer coisa acima
// de 1440px de largura. O JPEG sai em 1080 de largura (@1x), que é o tamanho em
// que a arte foi desenhada — nada é reamostrado pela Meta.
await mkdir(join(raiz, "saida", "jpeg"), { recursive: true });

// No servidor o Chromium vem do apt (o agente não baixa browser a cada deploy);
// na máquina de quem desenvolve, o do Playwright. Um `launch()` sem caminho
// procura só o segundo e falha no container com "Executable doesn't exist".
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const navegador = await chromium.launch(
  executablePath ? { executablePath, args: ["--no-sandbox"] } : {},
);
const pagina = await navegador.newPage({ deviceScaleFactor: 2 });

for (const arquivo of arquivos) {
  const destino = join(raiz, "saida", arquivo.replace(/\.html$/, ".png"));
  const origem = pathToFileURL(join(raiz, pasta, arquivo)).href;

  // O formato é 1080x1350 salvo se a peça declarar outro em <meta name="tamanho">.
  await pagina.setViewportSize({ width: 1080, height: 1350 });
  await pagina.goto(origem, { waitUntil: "load" });
  const [l, a] = await pagina.evaluate(() =>
    (document.querySelector('meta[name="tamanho"]')?.content ?? "1080x1350").split("x").map(Number));
  if (l !== 1080 || a !== 1350) {
    await pagina.setViewportSize({ width: l, height: a });
    await pagina.goto(origem, { waitUntil: "load" });
  }
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.screenshot({ path: destino, clip: { x: 0, y: 0, width: l, height: a } });

  // Versão pra publicar por API: JPEG, 1x, qualidade alta mas dentro dos 8 MB.
  await pagina.screenshot({
    path: join(raiz, "saida", "jpeg", arquivo.replace(/\.html$/, ".jpg")),
    clip: { x: 0, y: 0, width: l, height: a },
    type: "jpeg",
    quality: 92,
    scale: "css",
  });

  // Transbordo é defeito: a peça tem que caber na altura declarada sem rolagem.
  const altura = await pagina.evaluate(() => document.body.scrollHeight);
  const aviso = altura > a + 1 ? `  ⚠ TRANSBORDOU (${altura}px)` : "";
  console.log(`✓ ${arquivo.padEnd(34)} -> saida/${arquivo.replace(/\.html$/, ".png")}${aviso}`);
}

await navegador.close();
