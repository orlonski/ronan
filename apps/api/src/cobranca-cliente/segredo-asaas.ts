import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cifrar, decifrar, estaCifrado } from "../common/cripto";

/**
 * Os dois segredos da conexão com o Asaas de uma transportadora.
 *
 * 1. **A chave de API dela** — precisa voltar em claro a cada chamada, então é
 *    CIFRA (AES-256-GCM de `common/cripto.ts`), com sal próprio: a chave que
 *    abre isto não abre as chaves de IA, e vice-versa.
 * 2. **O token do webhook** — a gente só precisa CONFERIR o que o Asaas manda
 *    de volta, nunca mostrar. Então é HASH: um dump do banco não dá a ninguém o
 *    poder de declarar fatura paga.
 */

const SAL_CHAVE_ASAAS = "ronan:asaas-cliente:v1";

export function cifrarChaveAsaas(chave: string, segredo: string): string {
  return cifrar(chave, segredo, SAL_CHAVE_ASAAS);
}

/**
 * Decifra a chave guardada — e SÓ se estiver cifrada.
 *
 * O `decifrar` genérico devolve texto sem prefixo como veio (compatibilidade
 * com as chaves de IA antigas, gravadas em claro). Aqui isso seria um furo:
 * esta coluna nasceu cifrada, então valor sem prefixo só pode ser adulteração,
 * e o certo é recusar.
 */
export function decifrarChaveAsaas(guardada: string | null | undefined, segredo: string): string | null {
  if (!estaCifrado(guardada)) return null;
  return decifrar(guardada, segredo, SAL_CHAVE_ASAAS);
}

/** Os 4 últimos caracteres — o bastante pra reconhecer, inútil pra usar. */
export function finalDaChave(chave: string): string {
  return chave.trim().slice(-4);
}

/**
 * Token novo do webhook: 32 bytes aleatórios em base64url (43 caracteres).
 * O Asaas exige entre 32 e 255 caracteres, sem espaço — base64url cumpre.
 */
export function novoTokenWebhook(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTokenWebhook(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * O token recebido confere com o hash guardado? Tempo constante: comparar com
 * `===` vaza, pelo tempo de resposta, quantos caracteres do começo estão certos.
 */
export function tokenWebhookConfere(recebido: string | undefined | null, hashGuardado: string | null | undefined): boolean {
  if (!recebido || !hashGuardado || hashGuardado.length !== 64) return false;
  const a = Buffer.from(hashTokenWebhook(recebido), "hex");
  const b = Buffer.from(hashGuardado, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
