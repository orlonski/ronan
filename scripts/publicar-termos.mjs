#!/usr/bin/env node
/**
 * Publica uma versão dos Termos de Uso a partir do arquivo em `docs/`.
 *
 *   node scripts/publicar-termos.mjs                 # mostra o que faria
 *   node scripts/publicar-termos.mjs --publicar      # grava de verdade
 *
 * POR QUE UM SCRIPT, E NÃO UMA TELA:
 *
 * Publicar contrato é decisão rara, irreversível e de uma pessoa só. Tela de
 * edição convida a corrigir vírgula no ar — e texto publicado não se corrige:
 * alguém já aceitou aquele hash, e a prova dele não pode mudar embaixo.
 *
 * O texto mora em `docs/termos-de-uso.md`, versionado no git, revisado em diff.
 * Este script só carimba o que já foi revisado.
 *
 * SEGURANÇA: sem `--publicar` ele não escreve nada. O padrão é o ensaio.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

// O `@prisma/client` mora em `apps/api/node_modules`, não na raiz — mesmo
// motivo (e mesma solução) do `marketing/instagram/render.mjs`. `createRequire`
// resolve pelo NOME a partir de outra raiz, coisa que import de caminho
// absoluto não faz com os symlinks do pnpm.
const { PrismaClient } = createRequire(
  pathToFileURL(join(raiz, "apps/api/package.json")).href,
)("@prisma/client");
const ARQUIVO = join(raiz, "docs/termos-de-uso.md");
const publicar = process.argv.includes("--publicar");

const bruto = await readFile(ARQUIVO, "utf8");

// O frontmatter é metadado nosso, não faz parte do contrato — e se entrasse no
// corpo, entraria no hash, e "aceitou o texto X" incluiria uma linha de YAML.
const m = bruto.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!m) {
  console.error("O arquivo precisa de frontmatter com versao/tipo/vigenteDesde.");
  process.exit(1);
}
const meta = Object.fromEntries(
  m[1]
    .split("\n")
    .map((l) => l.split(/:\s*/))
    .filter((p) => p.length >= 2)
    .map(([k, ...v]) => [k.trim(), v.join(": ").trim().replace(/^"|"$/g, "")]),
);
const corpo = m[2].trim();

if (corpo.includes("[[")) {
  const faltando = [...corpo.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]);
  console.error(`Ainda há ${faltando.length} lacuna(s) no texto:\n  - ${faltando.join("\n  - ")}`);
  process.exit(1);
}

const sha256 = createHash("sha256").update(corpo, "utf8").digest("hex");

console.log(`Arquivo:  ${ARQUIVO.replace(raiz + "/", "")}`);
console.log(`Tipo:     ${meta.tipo}`);
console.log(`Versão:   ${meta.versao}`);
console.log(`Vigência: ${meta.vigenteDesde}`);
console.log(`Tamanho:  ${corpo.length} caracteres`);
console.log(`SHA-256:  ${sha256}`);

const prisma = new PrismaClient();

const existente = await prisma.termoVersao.findUnique({
  where: { tipo_versao: { tipo: meta.tipo, versao: meta.versao } },
});

if (existente) {
  const igual = existente.sha256 === sha256;
  console.log(
    `\n${meta.tipo} ${meta.versao} já está publicada.\n` +
      (igual
        ? "  O texto é idêntico ao do arquivo. Nada a fazer."
        : "  ⚠ O ARQUIVO DIVERGE do que está publicado.\n" +
          "  Texto publicado não se corrige — alguém pode já ter aceitado este hash.\n" +
          `  Suba a versão no frontmatter (ex.: ${proxima(meta.versao)}) e publique de novo.`),
  );
  await prisma.$disconnect();
  process.exit(igual ? 0 : 1);
}

if (!publicar) {
  console.log("\nEnsaio. Nada foi gravado.");
  console.log("Pra publicar de verdade:  node scripts/publicar-termos.mjs --publicar");
  await prisma.$disconnect();
  process.exit(0);
}

const criado = await prisma.termoVersao.create({
  data: {
    tipo: meta.tipo,
    versao: meta.versao,
    corpo,
    sha256,
    // Meia-noite em São Paulo, não em UTC: o container roda em UTC e
    // `new Date("2026-09-18")` viraria 21h do dia 17 no Brasil.
    vigenteDesde: new Date(`${meta.vigenteDesde}T00:00:00-03:00`),
    publicadoEm: new Date(),
    oQueMudou: meta.oQueMudou ?? null,
  },
});

console.log(`\nPublicado: ${criado.id}`);
console.log("A partir de agora o painel vai pedir o aceite de quem ainda não deu.");
await prisma.$disconnect();

function proxima(v) {
  const [a, b] = v.split(".").map(Number);
  return `${a}.${(b ?? 0) + 1}`;
}
