// Renderiza as peças HTML em PNG 1080x1350 @2x, prontas pro Instagram.
//   node render.mjs        -> renderiza tudo
//   node render.mjs 03     -> só a peça que começa com "03"
import { readdir, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// De onde sai o Playwright.
//
// Na máquina de quem desenvolve, do `node_modules` do próprio repo — e um
// `import` normal acharia. No agente não: cada execução roda num `git worktree`
// criado em /trabalho, e worktree não tem `node_modules` nenhum (não é coisa
// versionada). Instalar de lá exige aprovação humana, que às 7h da manhã não
// existe — e foi exatamente assim que duas pautas seguidas terminaram
// "concluídas" sem entregar post: o agente escreveu a peça, não conseguiu
// renderizar e não teve como publicar.
//
// PLAYWRIGHT_RAIZ aponta pro `node_modules` que a imagem já traz. `createRequire`
// em vez de `import()` porque resolve o pacote pelo nome (e os symlinks do pnpm)
// a partir de outra raiz, coisa que import de caminho absoluto não faz.
const raizPlaywright = process.env.PLAYWRIGHT_RAIZ;
const resolverDe = raizPlaywright
  ? pathToFileURL(join(raizPlaywright, "package.json")).href
  : import.meta.url;
let chromium;
try {
  ({ chromium } = createRequire(resolverDe)("@playwright/test"));
} catch (erro) {
  console.error(
    `Não achei o @playwright/test a partir de ${raizPlaywright ?? "deste arquivo"}.\n` +
      `  • Na sua máquina: rode 'pnpm install' na raiz do repositório.\n` +
      `  • No agente: PLAYWRIGHT_RAIZ tem que apontar pra uma pasta com node_modules\n` +
      `    (a imagem do ronan_agente traz em /repo).\n` +
      `  Detalhe: ${erro.message}`,
  );
  process.exit(1);
}

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

// O padrão do feed não é recomendação: é porteiro. Peça com defeito ainda é
// escrita em saida/ (pra você olhar o estrago), mas o processo sai com código 1
// e o `enfileirar.mjs` morre junto — ou seja, não chega na fila de publicação.
const defeitos = [];

// Celular tem que parecer celular. O print do app é 760x1645 (1:2,16) e a
// moldura `.celular.recorte` trava em 1:2,05. A faixa aceita cobre as duas com
// folga e ainda assim reprova o que já passou: 320x400 (1:1,25) e 330x360
// (1:1,09) saíram no feed parecendo tela gorda, e foi preciso apagar post
// publicado pra consertar.
const PROPORCAO_MIN = 1.9;
const PROPORCAO_MAX = 2.4;

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

  // Transbordo é defeito: a peça tem que caber na altura declarada.
  //
  // Mede o elemento que termina mais embaixo, não o `scrollHeight` do body: com
  // `overflow: hidden` em qualquer ancestral o scrollHeight para em 1350 e o
  // rodapé sai cortado na imagem sem ninguém reclamar. Foi assim que a 15 saiu
  // do agente com "No app do Movatruck" faltando metade da letra.
  // Só TEXTO conta. Sangrar imagem na borda é decisão de arte — a 06, a 09 e a
  // moldura da 08 fazem isso de propósito. Letra cortada nunca é de propósito.
  const vazado = await pagina.evaluate((limite) => {
    const temTextoProprio = (el) =>
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return [...document.querySelectorAll("body *")]
      .filter(temTextoProprio)
      .map((el) => ({ fim: Math.round(el.getBoundingClientRect().bottom), texto: el.textContent.trim().slice(0, 40) }))
      .filter((x) => x.fim > limite + 1)
      .sort((a, b) => b.fim - a.fim)[0] ?? null;
  }, a);
  if (vazado) {
    defeitos.push(`${arquivo}: texto cortado na borda de baixo — "${vazado.texto}" termina em ${vazado.fim}px, ${vazado.fim - a}px além do limite.
    Corte texto — não diminua a fonte.`);
  }

  const celulares = await pagina.evaluate(() =>
    [...document.querySelectorAll(".celular")].map((el) => {
      const { width, height } = el.getBoundingClientRect();
      return { largura: Math.round(width), altura: Math.round(height) };
    }));
  celulares.forEach(({ largura, altura: alt }, i) => {
    const proporcao = alt / largura;
    if (proporcao >= PROPORCAO_MIN && proporcao <= PROPORCAO_MAX) return;
    const qual = celulares.length > 1 ? ` (celular ${i + 1} de ${celulares.length})` : "";
    defeitos.push(
      `${arquivo}: a moldura do celular${qual} está ${largura}x${alt} — 1:${proporcao.toFixed(2)}, ` +
        `fora da faixa 1:${PROPORCAO_MIN}–1:${PROPORCAO_MAX}.
    Use class="celular recorte" e declare SÓ a largura; a altura sai da proporção.
    Pra mostrar menos tela, diminua a largura — nunca achate a caixa.`,
    );
  });

  console.log(`✓ ${arquivo.padEnd(34)} -> saida/${arquivo.replace(/\.html$/, ".png")}`);
}

await navegador.close();

if (defeitos.length) {
  console.error(`\n✗ ${defeitos.length} peça(s) fora do padrão — nada disto vai pra fila:\n`);
  for (const d of defeitos) console.error(`  • ${d}\n`);
  process.exit(1);
}
