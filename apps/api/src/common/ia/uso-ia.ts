/**
 * Quanto custou cada chamada de IA.
 *
 * Até aqui o `usage` que a Anthropic devolve em toda resposta era simplesmente
 * descartado, e a consequência é que ninguém no sistema consegue responder
 * "quanto o OCR de ticket custou este mês". Pior: a tela de configuração de IA
 * mostra "~R$ 0,01 por match" — números escritos à mão no frontend, sem nenhum
 * dado por trás.
 *
 * Este arquivo é só aritmética pura (sem Prisma, sem Nest) pra poder ser testado
 * direto. Quem grava é o `UsoIaService`.
 */

/** Preço em dólar por MILHÃO de tokens. */
export type PrecoModelo = {
  entrada: number;
  saida: number;
  /**
   * Preço ABSOLUTO do token de cache, quando o fornecedor publica um em vez de
   * um desconto sobre a entrada.
   *
   * Os multiplicadores abaixo nasceram da tabela da Anthropic, onde ler do
   * cache é sempre 10% da entrada. Não é lei do universo: no MiniMax é 20%.
   * Quem tiver preço próprio declara aqui; quem não tiver segue no multiplicador.
   */
  cacheLeitura?: number;
  cacheEscrita?: number;
};

/**
 * Tabela de preços por modelo (conferida em 2026-08-24).
 *
 * As chaves são os ids exatos de modelo. Modelo que não estiver aqui não
 * quebra nada: o custo sai `null` e o resto do registro (tokens, duração) é
 * gravado do mesmo jeito — perder a conta é bem melhor que perder a medição.
 */
export const PRECOS_POR_MODELO: Record<string, PrecoModelo> = {
  // Haiku 4.5 — o que roda hoje no OCR e no match.
  "claude-haiku-4-5": { entrada: 1, saida: 5 },
  "claude-haiku-4-5-20251001": { entrada: 1, saida: 5 },

  // Sonnet — preço cheio de propósito. Houve um preço promocional de entrada
  // ($2/$10) com validade curta; usar o cheio erra pra cima, e errar pra cima
  // num relatório de custo é o lado seguro.
  "claude-sonnet-5": { entrada: 3, saida: 15 },
  "claude-sonnet-4-6": { entrada: 3, saida: 15 },

  // Opus — a segunda opinião do conferente.
  "claude-opus-5": { entrada: 5, saida: 25 },
  "claude-opus-4-8": { entrada: 5, saida: 25 },
  "claude-opus-4-7": { entrada: 5, saida: 25 },
  "claude-opus-4-6": { entrada: 5, saida: 25 },

  // MiniMax — fornecedor externo, API compatível com a da Anthropic. O M3 é o
  // único da linha que enxerga imagem (os M2.x são só texto), então é o único
  // que serve pra ticket.
  //
  // Preço de tabela ≤512k de input, tier padrão, com o desconto "Permanent 50%
  // off" que eles anunciam já aplicado. Sem o desconto seria $0,60/$2,40 — que
  // continua abaixo do Haiku. O cache de LEITURA tem preço próprio ($0,06/MTok,
  // 20% da entrada e não 10%); o de ESCRITA eles não publicam pro M3, então cai
  // no multiplicador de 1,25x, que erra pra cima — o mesmo lado seguro que o
  // Sonnet já usa aqui.
  "MiniMax-M3": { entrada: 0.3, saida: 1.2, cacheLeitura: 0.06 },
};

/**
 * Multiplicadores do cache sobre o preço de ENTRADA do modelo.
 *
 * Ler do cache custa ~10% de um token novo — é justamente isso que torna o
 * prompt caching a otimização mais barata que existe aqui. Escrever custa mais
 * que um token normal, e o quanto depende do TTL escolhido (5 min ou 1 hora).
 */
export const MULT_CACHE_LEITURA = 0.1;
export const MULT_CACHE_ESCRITA_5M = 1.25;
export const MULT_CACHE_ESCRITA_1H = 2;

/**
 * O `usage` da resposta da Anthropic, no que interessa pra conta.
 *
 * `cache_creation` detalhado por TTL nem sempre vem; quando não vier, caímos em
 * `cache_creation_input_tokens` e assumimos o multiplicador de 5 min.
 */
export type UsageAnthropic = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
};

export type UsoNormalizado = {
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
  /** `null` quando o modelo não está na tabela de preços. */
  custoUsd: number | null;
};

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

/**
 * Normaliza o `usage` e calcula o custo.
 *
 * Nunca lança: é chamada dentro de caminhos que não podem quebrar por causa de
 * contabilidade. Payload estranho vira zero, modelo desconhecido vira custo nulo.
 */
export function calcularUso(modelo: string, usage: UsageAnthropic | null | undefined): UsoNormalizado {
  const u = usage ?? {};

  const tokensEntrada = num(u.input_tokens);
  const tokensSaida = num(u.output_tokens);
  const tokensCacheLeitura = num(u.cache_read_input_tokens);

  const escrita5m = num(u.cache_creation?.ephemeral_5m_input_tokens);
  const escrita1h = num(u.cache_creation?.ephemeral_1h_input_tokens);
  const escritaDetalhada = escrita5m + escrita1h;
  // Sem o detalhamento por TTL, o total agregado responde — e entra como 5 min,
  // que é o multiplicador menor. Subestimar aqui é aceitável porque a escrita
  // acontece uma vez por janela, não a cada chamada.
  const tokensCacheEscrita = escritaDetalhada > 0 ? escritaDetalhada : num(u.cache_creation_input_tokens);

  const preco = PRECOS_POR_MODELO[modelo];
  if (!preco) {
    return { tokensEntrada, tokensSaida, tokensCacheLeitura, tokensCacheEscrita, custoUsd: null };
  }

  const porMilhao = (tokens: number, precoUnitario: number) => (tokens / 1_000_000) * precoUnitario;

  // Preço absoluto do fornecedor vence o multiplicador; sem ele, o desconto
  // sobre a entrada, que é como a Anthropic cobra.
  const precoCacheLeitura = preco.cacheLeitura ?? preco.entrada * MULT_CACHE_LEITURA;
  const precoEscrita5m = preco.cacheEscrita ?? preco.entrada * MULT_CACHE_ESCRITA_5M;
  const precoEscrita1h = preco.cacheEscrita ?? preco.entrada * MULT_CACHE_ESCRITA_1H;

  const custoEscrita =
    escritaDetalhada > 0
      ? porMilhao(escrita5m, precoEscrita5m) + porMilhao(escrita1h, precoEscrita1h)
      : porMilhao(tokensCacheEscrita, precoEscrita5m);

  const custoUsd =
    porMilhao(tokensEntrada, preco.entrada) +
    porMilhao(tokensSaida, preco.saida) +
    porMilhao(tokensCacheLeitura, precoCacheLeitura) +
    custoEscrita;

  return {
    tokensEntrada,
    tokensSaida,
    tokensCacheLeitura,
    tokensCacheEscrita,
    // 6 casas: uma chamada de Haiku custa na casa do milésimo de dólar, e
    // arredondar antes de somar o mês inteiro zeraria a conta.
    custoUsd: Math.round(custoUsd * 1_000_000) / 1_000_000,
  };
}

/**
 * Onde a chamada foi feita. Vai pra coluna `escopo` e é por ele que o relatório
 * separa "o OCR do app" de "o conferente" — os dois usam o mesmo modelo, então
 * sem isso não dá pra saber qual dos dois está pesando.
 */
export const ESCOPOS_IA = ["ocr-app", "conferencia", "match", "layout", "transcricao"] as const;
export type EscopoIa = (typeof ESCOPOS_IA)[number];
