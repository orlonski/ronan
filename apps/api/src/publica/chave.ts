import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * O formato da chave de acesso das integrações.
 *
 *   mvt_live_<43 base62 = 256 bits><6 base62 = CRC32 do corpo>
 *
 * - O prefixo em claro deixa gente, log e scanner reconhecerem a chave sem
 *   consultar banco — e o guard recusa sem ir ao banco tudo que não tem o
 *   formato (um JWT do painel, lixo, chave do portal da obra).
 * - Base62, não base64url: o `-` e o `_` quebram o duplo clique e deixam a
 *   regex do scanner ambígua.
 * - O CRC32 não dá segurança nenhuma. Serve pra descartar chave digitada
 *   errado (e falso positivo de scanner) sem gastar uma consulta.
 * - No banco vai só o SHA-256 do texto inteiro. Com 256 bits aleatórios não
 *   existe dicionário, e um hash lento (bcrypt, argon2) só daria a quem não tem
 *   chave nenhuma um jeito barato de gastar a nossa CPU.
 *
 * Ver docs/api-publica/03-seguranca.md §1.
 */

export const PREFIXO_CHAVE_LIVE = "mvt_live_";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TAMANHO_CORPO = 43;
const TAMANHO_CRC = 6;
const FORMATO = new RegExp(`^${PREFIXO_CHAVE_LIVE}[0-9A-Za-z]{${TAMANHO_CORPO + TAMANHO_CRC}}$`);

/** Acha uma chave nossa dentro de qualquer texto (log, corpo, mensagem de erro). */
export const CHAVE_NO_TEXTO = /mvt_(?:live|test)_[0-9A-Za-z]{49}/g;

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(texto: string): number {
  let c = 0xffffffff;
  for (const b of Buffer.from(texto, "utf8")) c = TABELA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function base62(n: bigint, tamanho: number): string {
  let s = "";
  while (n > 0n) {
    s = BASE62[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s.padStart(tamanho, "0").slice(-tamanho);
}

function crcEmBase62(corpo: string): string {
  return base62(BigInt(crc32(corpo)), TAMANHO_CRC);
}

/** Uma chave nova. O texto completo só existe aqui e na tela de quem criou. */
export function gerarChave(): string {
  const corpo = base62(BigInt(`0x${randomBytes(32).toString("hex")}`), TAMANHO_CORPO);
  return `${PREFIXO_CHAVE_LIVE}${corpo}${crcEmBase62(corpo)}`;
}

/** Formato e CRC certos. Não diz se a chave existe — só se vale a pena perguntar ao banco. */
export function formatoDeChaveValido(chave: string): boolean {
  if (!FORMATO.test(chave)) return false;
  const resto = chave.slice(PREFIXO_CHAVE_LIVE.length);
  const corpo = resto.slice(0, TAMANHO_CORPO);
  return crcEmBase62(corpo) === resto.slice(TAMANHO_CORPO);
}

export function hashDaChave(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

/** Comparação de hash em tempo constante (o lookup é por índice, isto é cinto e suspensório). */
export function hashConfere(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** O que a tela mostra: `mvt_live_Ab3k` … `x9Qe`. */
export function partesVisiveis(chave: string): { inicio: string; final: string } {
  return { inicio: chave.slice(0, PREFIXO_CHAVE_LIVE.length + 4), final: chave.slice(-4) };
}

export function mascaraDaChave(inicio: string, final: string): string {
  return `${inicio}…${final}`;
}
