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

/**
 * O número em que dá pra FALAR — com o nono dígito de volta — ou `null`
 * quando não existe número ali.
 *
 * Cadastro antigo guarda celular com 10 dígitos, de antes de 2016:
 * "4399912345". Quem veio do registro público da ANTT e da Receita é quase
 * todo assim — na primeira varredura da base foram 39 de 47. Exibir, discar
 * ou procurar no WhatsApp com esse número não acha ninguém, e recusá-lo
 * jogaria fora a maior parte dos contatos.
 *
 * Celular velho se reconhece pelo terceiro dígito: 6 a 9 é móvel (ganha o 9),
 * 2 a 5 é fixo (fica como está). O resto não pode existir — "00000000002" tem
 * onze dígitos e passa em qualquer checagem de tamanho.
 *
 * Não confundir com o que a Meta usa: os payloads dela IDENTIFICAM número
 * brasileiro sem o nono dígito. Rotear inbox por número é sem; falar é com.
 */
export function telefoneDiscavel(input: string): string | null {
  const d = telefoneDigits(input).replace(/^55(?=\d{10,11}$)/, "");
  if (d.length < 10 || d.length > 11) return null;

  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;

  const terceiro = d[2] ?? "";
  if (d.length === 11) return terceiro === "9" ? d : null;
  if (/[6-9]/.test(terceiro)) return `${d.slice(0, 2)}9${d.slice(2)}`;
  return /[2-5]/.test(terceiro) ? d : null;
}
