/**
 * O que numa viagem pertence à relação comercial Schaba↔cliente, e não à
 * operação de transporte.
 *
 * Gatado por `viagens.ver-comercial` (catálogo de permissões). O gestor de uma
 * transportadora terceira precisa conferir o que os motoristas dele lançaram —
 * ticket, km, toneladas, fotos —, mas a carteira de clientes da Schaba e o que
 * cada viagem fatura não são dele.
 *
 * A omissão acontece AQUI, na fronteira de serialização do admin, e nunca
 * dentro de `common/viagem-minimos.ts`: aquele helper é compartilhado com o app
 * do motorista, que expõe `kmEfetivo`/`toneladasEfetiva` legitimamente.
 */
const CAMPOS_COMERCIAIS = [
  "cliente",
  "clienteId",
  "regraMinimo",
  // Derivados do mínimo faturado (o real continua em km/toneladas).
  "kmEfetivo",
  "kmAjustada",
  "toneladasEfetiva",
  "toneladasAjustada",
  "matchesFechamento",
] as const;

/**
 * Devolve a viagem sem os campos comerciais. Some do JSON, não só da tela — o
 * painel chama a API direto do browser, então esconder na UI não esconde nada.
 */
export function omitirComercial<T extends Record<string, unknown>>(viagem: T): T {
  const copia = { ...viagem };
  for (const campo of CAMPOS_COMERCIAIS) delete copia[campo];

  // `_count.matchesFechamento` alimenta o aviso "já está em fechamento" na
  // lista — é contagem, mas denuncia o fluxo de faturamento. Sai junto.
  const count = (copia as Record<string, unknown>)._count;
  if (count && typeof count === "object") {
    const { matchesFechamento: _, ...resto } = count as Record<string, unknown>;
    (copia as Record<string, unknown>)._count = resto;
  }
  return copia;
}

/** Aplica `omitirComercial` numa lista, ou devolve como está se pode ver. */
export function filtrarComercial<T extends Record<string, unknown>>(
  itens: T[],
  podeVerComercial: boolean,
): T[] {
  return podeVerComercial ? itens : itens.map(omitirComercial);
}
