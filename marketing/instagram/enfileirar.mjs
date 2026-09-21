// Entrega um post pronto pra fila de publicação.
//
// É o último passo do agente de publicidade: depois de escrever a peça em
// posts/ e a legenda, ele renderiza e chama isto. Daqui em diante quem cuida é
// o publicador — o post entra na fila e sai no horário, sem ninguém presente.
//
//   node enfileirar.mjs <peca> <arquivo-de-legenda> [quando]
//
//   peca              nome do arquivo em posts/, sem extensão (ex.: 11-permissoes).
//                     Carrossel não muda nada aqui: o script recolhe os slides
//                     que o render produziu e manda todos.
//   arquivo-legenda   caminho de um .txt/.md com a legenda já pronta
//   quando            ISO 8601 (ex.: 2026-09-15T09:00:00-03:00). Sem isto o
//                     post entra como rascunho e o cron não pega.
//
// Ambiente:
//   MARKETING_API_URL     padrão http://ronan-api:3000 (rede interna do Docker)
//   MARKETING_INGEST_TOKEN  o mesmo segredo que a API tem
//
// O JPEG é gerado por render.mjs. A API recusa PNG, porque a Meta recusa PNG.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const [peca, arquivoLegenda, quando] = process.argv.slice(2);

if (!peca || !arquivoLegenda) {
  console.error("uso: node enfileirar.mjs <peca> <arquivo-de-legenda> [quando-iso]");
  process.exit(1);
}

const token = process.env.MARKETING_INGEST_TOKEN;
if (!token) {
  console.error("MARKETING_INGEST_TOKEN ausente — sem ele a API recusa a entrega.");
  process.exit(1);
}
const api = (process.env.MARKETING_API_URL ?? "http://ronan-api:3000").replace(/\/+$/, "");

// 1. A peça precisa existir. Errar o nome aqui renderiza a coisa errada.
const html = join(raiz, "posts", `${peca}.html`);
if (!existsSync(html)) {
  console.error(`Não achei posts/${peca}.html — confira o nome da peça.`);
  process.exit(1);
}

// 2. Renderiza. O render escreve PNG e JPEG; a API quer o JPEG.
//    Peça fora do padrão faz o render sair com código != 0, e o execFileSync
//    lança aqui — ou seja, nada chega na fila. É o porteiro de verdade.
console.log(`renderizando ${peca}…`);
execFileSync("node", [join(raiz, "render.mjs"), peca], { stdio: "inherit" });

// Recolhe os slides. Post de imagem única sai como `<peca>.jpg`; carrossel sai
// numerado, `<peca>-1.jpg`, `-2.jpg`… É por aqui que a ordem do feed se decide,
// e por isso o laço conta de 1 em 1 em vez de listar a pasta e ordenar por
// nome: `-10.jpg` viria antes de `-2.jpg` e o carrossel sairia embaralhado.
const jpegs = [];
const unico = join(raiz, "saida", "jpeg", `${peca}.jpg`);
if (existsSync(unico)) {
  jpegs.push(unico);
} else {
  for (let i = 1; i <= 10; i++) {
    const slide = join(raiz, "saida", "jpeg", `${peca}-${i}.jpg`);
    if (!existsSync(slide)) break;
    jpegs.push(slide);
  }
}
if (jpegs.length === 0) {
  console.error(
    `O render não produziu saida/jpeg/${peca}.jpg nem saida/jpeg/${peca}-1.jpg.\n` +
      `  Confira se a peça tem pelo menos um <div class="peca">.`,
  );
  process.exit(1);
}

// 3. A legenda vem de arquivo, não de argumento: legenda tem quebra de linha,
//    acento e hashtag, e passar isso por linha de comando é pedir para o shell
//    comer alguma coisa no meio.
const legenda = (await readFile(arquivoLegenda, "utf8")).trim();
if (!legenda) {
  console.error(`${arquivoLegenda} está vazio.`);
  process.exit(1);
}
if (legenda.length > 2200) {
  console.error(`A legenda tem ${legenda.length} caracteres; o Instagram corta em 2200.`);
  process.exit(1);
}

// 4. Entrega.
const fd = new FormData();
// Mesmo campo repetido, na ordem dos slides: é a ordem de chegada que a API usa
// pra numerar, e a que o leitor desliza.
for (const jpeg of jpegs) {
  fd.append("artes", new Blob([await readFile(jpeg)], { type: "image/jpeg" }), basename(jpeg));
}
fd.append("peca", peca);
fd.append("legenda", legenda);
if (quando) fd.append("publicarEm", new Date(quando).toISOString());

const resposta = await fetch(`${api}/marketing/instagram/ingestao`, {
  method: "POST",
  headers: { "X-Marketing-Token": token },
  body: fd,
});

const corpo = await resposta.json().catch(() => ({}));
if (!resposta.ok) {
  // `issues` é o formato que o ZodValidationPipe devolve.
  const motivo =
    corpo?.issues?.map((i) => i.message).join("; ") ?? corpo?.message ?? `HTTP ${resposta.status}`;
  console.error(`A API recusou: ${motivo}`);
  process.exit(1);
}

// Repete quantos slides entraram, e não quantos foram mandados: o número vem da
// resposta da API, então é o que está no banco. Divergiu, foi aqui que se viu.
console.log(
  `na fila: ${corpo.peca} · ${corpo.status}` +
    ` · ${corpo.slides === 1 ? "imagem única" : `carrossel de ${corpo.slides} slides`}` +
    (corpo.publicarEm ? ` · sai em ${corpo.publicarEm}` : " · rascunho, sem hora marcada"),
);
