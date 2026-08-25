/**
 * De qual fornecedor é um modelo, e como falar com ele.
 *
 * O MiniMax publica uma API **compatível com a da Anthropic** — mesmo formato
 * de `messages`, mesmos blocos de `image` em base64, mesmo `usage` na resposta.
 * Isso é o que permite atender os dois com o `@anthropic-ai/sdk` que já estava
 * aqui: o que muda é `baseURL`, a chave e o id do modelo. Nenhum corpo de
 * request precisou ser reescrito.
 *
 * Aritmética pura, sem Nest e sem SDK, do mesmo jeito que `uso-ia.ts` — quem
 * monta cliente é a `ClienteIaFactory`.
 */

export const PROVEDORES_IA = ["anthropic", "minimax"] as const;
export type ProvedorIa = (typeof PROVEDORES_IA)[number];

/** Endpoint compatível com a Anthropic. O `/anthropic` no fim é obrigatório. */
export const BASE_URL_MINIMAX = "https://api.minimax.io/anthropic";

/**
 * Descobre o fornecedor pelo id do modelo.
 *
 * A regra é o prefixo do nome, e não uma lista de ids: assim `MiniMax-M4` ou
 * `MiniMax-M3-highspeed` funcionam no dia em que existirem, sem deploy. O
 * default é `anthropic` porque é o que estava aqui antes — id desconhecido
 * continua indo pro caminho de sempre e falha com o erro da Anthropic, que é
 * mais informativo que um erro nosso.
 */
export function provedorDoModelo(modelo: string): ProvedorIa {
  return /^\s*minimax[-_]/i.test(modelo) ? "minimax" : "anthropic";
}

/** Nome da env var com a chave daquele fornecedor. */
export function chaveDoProvedor(provedor: ProvedorIa): string {
  return provedor === "minimax" ? "MINIMAX_API_KEY" : "ANTHROPIC_API_KEY";
}
