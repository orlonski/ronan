import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Assinatura dos avisos no padrão Standard Webhooks (standardwebhooks.com):
 *
 *   webhook-id:        evt_… (o MESMO em toda tentativa — é por ele que se descarta repetido)
 *   webhook-timestamp: segundos Unix
 *   webhook-signature: v1,<base64 HMAC-SHA256 de "id.timestamp.corpo">
 *
 * Padrão de mercado de propósito: o integrador usa a biblioteca pronta da
 * linguagem dele (svix, standardwebhooks) e não depende de SDK nosso.
 */

export const PREFIXO_SEGREDO = "whsec_";

export function gerarSegredoAviso(): string {
  return `${PREFIXO_SEGREDO}${randomBytes(24).toString("base64")}`;
}

export function assinar(segredo: string, id: string, timestamp: number, corpo: string): string {
  const chave = Buffer.from(segredo.slice(PREFIXO_SEGREDO.length), "base64");
  const sig = createHmac("sha256", chave).update(`${id}.${timestamp}.${corpo}`).digest("base64");
  return `v1,${sig}`;
}

/** O que o integrador faz do lado dele. Aqui pra teste e pra documentação. */
export function assinaturaConfere(segredo: string, id: string, timestamp: number, corpo: string, cabecalho: string): boolean {
  const esperada = Buffer.from(assinar(segredo, id, timestamp, corpo));
  return cabecalho.split(" ").some((s) => {
    const b = Buffer.from(s);
    return b.length === esperada.length && timingSafeEqual(b, esperada);
  });
}
