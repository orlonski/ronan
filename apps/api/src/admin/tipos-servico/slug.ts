/**
 * "Diária de caminhão" → "diaria-de-caminhao"
 *
 * O slug é a chave ESTÁVEL do modo de serviço (usada no seed e no código);
 * o admin renomeia o `nome` à vontade sem que o slug mude junto.
 */
export function slugificar(bruto: string): string {
  const slug = bruto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // Nome só de símbolos ("---") zeraria o slug e quebraria o @@unique.
  return slug || "modo";
}
