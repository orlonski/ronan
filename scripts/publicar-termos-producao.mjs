#!/usr/bin/env node
/**
 * Publica os Termos EM PRODUÇÃO, pela API.
 *
 *   node scripts/publicar-termos-producao.mjs
 *
 * POR QUE PELA API, E NÃO NO BANCO:
 *
 * Publicar contrato é ato da plataforma, e o endpoint `POST /admin/termos` já
 * está atrás do `PlataformaGuard`. Mexer direto no banco de produção pularia a
 * validação (hash, versão duplicada) e exigiria espalhar a senha do Postgres
 * por aí — o pior dos dois mundos.
 *
 * A SENHA NÃO APARECE: é lida com o eco desligado, não vai pra variável de
 * ambiente, não entra no histórico do shell e não é impressa em log nenhum.
 *
 * O texto vem de `docs/termos-de-uso.md`, o mesmo arquivo versionado no git —
 * é o que garante que o que foi revisado em diff é o que vai pro ar.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.API_URL ?? "https://ronan-api.2azr6q.easypanel.host";

const bruto = await readFile(join(raiz, "docs/termos-de-uso.md"), "utf8");
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
  console.error("O texto ainda tem lacunas [[...]]. Não publique assim.");
  process.exit(1);
}

const sha256 = createHash("sha256").update(corpo, "utf8").digest("hex");

console.log(`\nDestino:  ${API}`);
console.log(`Tipo:     ${meta.tipo}`);
console.log(`Versão:   ${meta.versao}`);
console.log(`Vigência: ${meta.vigenteDesde}`);
console.log(`SHA-256:  ${sha256}\n`);

console.log("A partir do primeiro aceite, este texto NÃO pode mais ser corrigido —");
console.log("só substituído por uma versão nova, com reaceite de todo mundo.\n");

const email = await perguntar("E-mail do seu login de plataforma: ");
const senha = await perguntarSegredo("Senha (não aparece na tela): ");

const login = await fetch(`${API}/admin/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, senha }),
});
if (!login.ok) {
  console.error(`\nLogin recusado (HTTP ${login.status}).`);
  process.exit(1);
}
const { accessToken } = await login.json();

// Confere o estado ANTES de escrever: se já existe e o texto é o mesmo, não há
// o que fazer; se existe e diverge, publicar seria criar uma segunda verdade.
const jaLa = await fetch(`${API}/termos?tipo=${meta.tipo}`).then((r) => (r.ok ? r.json() : []));
const mesmaVersao = jaLa.find((t) => t.versao === meta.versao);
if (mesmaVersao) {
  console.log(
    mesmaVersao.sha256 === sha256
      ? `\n${meta.tipo} ${meta.versao} já está publicada com este mesmo texto. Nada a fazer.`
      : `\n⚠ ${meta.tipo} ${meta.versao} já está publicada com um texto DIFERENTE.\n` +
          `  Texto publicado não se corrige. Suba a versão no frontmatter e publique de novo.`,
  );
  process.exit(mesmaVersao.sha256 === sha256 ? 0 : 1);
}

const ok = await perguntar(`Publicar ${meta.tipo} ${meta.versao} em produção? (digite: publicar) `);
if (ok.trim() !== "publicar") {
  console.log("Cancelado. Nada foi gravado.");
  process.exit(0);
}

const r = await fetch(`${API}/admin/termos`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({
    tipo: meta.tipo,
    versao: meta.versao,
    corpo,
    vigenteDesde: meta.vigenteDesde,
    ...(meta.oQueMudou ? { oQueMudou: meta.oQueMudou } : {}),
  }),
});

if (!r.ok) {
  console.error(`\nA API recusou (HTTP ${r.status}):`);
  console.error(await r.text());
  process.exit(1);
}

const criado = await r.json();
console.log(`\nPublicado: ${criado.id}`);
console.log(`Confira em: https://app.movatruck.com.br/termos`);
console.log("A partir de agora o painel pede o aceite de quem ainda não deu.");

function perguntar(texto) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (v) => (rl.close(), r(v))));
}

/** Lê sem ecoar: a senha não aparece na tela nem fica no scrollback. */
function perguntarSegredo(texto) {
  return new Promise((resolve) => {
    process.stdout.write(texto);
    const stdin = process.stdin;
    const eraRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    let buf = "";
    const onData = (ch) => {
      const c = ch.toString("utf8");
      if (c === "\n" || c === "\r" || c === "") {
        stdin.setRawMode?.(eraRaw ?? false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(buf);
      } else if (c === "") {
        process.stdout.write("\n");
        process.exit(1);
      } else if (c === "") {
        buf = buf.slice(0, -1);
      } else {
        buf += c;
      }
    };
    stdin.on("data", onData);
  });
}
