import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link público ASSINADO pra um documento (ex.: o PDF do acerto). Sem tabela:
 * o token carrega o que abre (id + conta) e até quando, e a assinatura HMAC
 * garante que ninguém troca o id por outro. Quem tem o link abre aquele
 * documento — e só ele, só até expirar.
 */

const b64 = (s: Buffer | string) => Buffer.from(s).toString("base64url");

export function assinarLink(
  dados: { tipo: string; id: string; contaId: string; expiraEm: Date },
  segredo: string,
): string {
  const corpo = b64(JSON.stringify({ t: dados.tipo, i: dados.id, c: dados.contaId, e: Math.floor(dados.expiraEm.getTime() / 1000) }));
  const sig = createHmac("sha256", segredo).update(corpo).digest("base64url").slice(0, 43);
  return `${corpo}.${sig}`;
}

export function lerLinkAssinado(
  token: string,
  tipo: string,
  segredo: string,
  agora = new Date(),
): { id: string; contaId: string } | null {
  const [corpo, sig] = token.split(".");
  if (!corpo || !sig) return null;
  const esperado = createHmac("sha256", segredo).update(corpo).digest("base64url").slice(0, 43);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString()) as { t: string; i: string; c: string; e: number };
    if (d.t !== tipo || d.e * 1000 < agora.getTime()) return null;
    return { id: d.i, contaId: d.c };
  } catch {
    return null;
  }
}
