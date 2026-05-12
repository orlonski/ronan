/**
 * Tira parênteses, traços, espaços. Retorna só dígitos.
 */
export function telefoneDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Aceita 10 dígitos (fixo: DDD + 8) ou 11 dígitos (celular: DDD + 9 + 8).
 */
export function isTelefoneValid(input: string): boolean {
  const d = telefoneDigits(input);
  return d.length === 10 || d.length === 11;
}

/**
 * Máscara progressiva enquanto o usuário digita.
 *   0-2  → 00
 *   3-6  → (00) 0000
 *   7-10 → (00) 0000-0000   (fixo)
 *   11   → (00) 00000-0000  (celular)
 */
export function maskTelefone(input: string): string {
  const d = telefoneDigits(input).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Formata pra exibição final. Se não tiver 10 ou 11 dígitos, retorna como veio.
 */
export function formatTelefone(input: string): string {
  const d = telefoneDigits(input);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return input;
}
