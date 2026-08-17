import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante. Compara o SHA-256 dos dois (não o
 * texto): `timingSafeEqual` exige buffers do mesmo tamanho, e comparar tamanho
 * antes já vazaria o comprimento do segredo.
 *
 * Mora em `common/` porque mais de um webhook autenticado por segredo
 * compartilhado depende dela (runner do ClickUp, webhook do WhatsApp).
 */
export function segredoConfere(recebido: string | undefined, esperado: string): boolean {
  if (!esperado || !recebido) return false;
  const a = createHash("sha256").update(recebido, "utf8").digest();
  const b = createHash("sha256").update(esperado, "utf8").digest();
  return timingSafeEqual(a, b);
}
