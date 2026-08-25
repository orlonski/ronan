import { describe, it, expect } from "vitest";
import {
  calcularUso,
  PRECOS_POR_MODELO,
  MULT_CACHE_LEITURA,
  MULT_CACHE_ESCRITA_5M,
  MULT_CACHE_ESCRITA_1H,
} from "./uso-ia";

const HAIKU = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-5";

describe("calcularUso", () => {
  it("conta entrada e saída pelo preço do modelo", () => {
    // Haiku: $1/MTok entrada, $5/MTok saída.
    const r = calcularUso(HAIKU, { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(r.tokensEntrada).toBe(1_000_000);
    expect(r.tokensSaida).toBe(1_000_000);
    expect(r.custoUsd).toBeCloseTo(6, 6);
  });

  it("Opus custa 5x a entrada e 5x a saída do Haiku", () => {
    const haiku = calcularUso(HAIKU, { input_tokens: 100_000, output_tokens: 10_000 });
    const opus = calcularUso(OPUS, { input_tokens: 100_000, output_tokens: 10_000 });
    expect(opus.custoUsd!).toBeCloseTo(haiku.custoUsd! * 5, 6);
  });

  it("token lido do cache custa 10% de um token novo — é o motivo do prompt caching", () => {
    const semCache = calcularUso(HAIKU, { input_tokens: 100_000 });
    const soCache = calcularUso(HAIKU, { cache_read_input_tokens: 100_000 });
    expect(soCache.custoUsd!).toBeCloseTo(semCache.custoUsd! * MULT_CACHE_LEITURA, 8);
  });

  it("escrita no cache usa o multiplicador do TTL declarado", () => {
    const preco = PRECOS_POR_MODELO[HAIKU].entrada;
    const r = calcularUso(HAIKU, {
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
    });
    expect(r.tokensCacheEscrita).toBe(2_000_000);
    expect(r.custoUsd).toBeCloseTo(preco * MULT_CACHE_ESCRITA_5M + preco * MULT_CACHE_ESCRITA_1H, 6);
  });

  it("sem detalhamento por TTL, cai no total agregado e assume 5 min", () => {
    const preco = PRECOS_POR_MODELO[HAIKU].entrada;
    const r = calcularUso(HAIKU, { cache_creation_input_tokens: 1_000_000 });
    expect(r.tokensCacheEscrita).toBe(1_000_000);
    expect(r.custoUsd).toBeCloseTo(preco * MULT_CACHE_ESCRITA_5M, 6);
  });

  it("o detalhado vence o agregado quando os dois vêm (senão contaria em dobro)", () => {
    const r = calcularUso(HAIKU, {
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000_000 },
    });
    expect(r.tokensCacheEscrita).toBe(1_000_000);
  });

  it("modelo fora da tabela mede os tokens mas não inventa custo", () => {
    const r = calcularUso("modelo-que-nao-existe", { input_tokens: 500, output_tokens: 100 });
    expect(r.tokensEntrada).toBe(500);
    expect(r.tokensSaida).toBe(100);
    expect(r.custoUsd).toBeNull();
  });

  it("usage ausente ou torto vira zero, nunca exceção", () => {
    expect(calcularUso(HAIKU, null).custoUsd).toBe(0);
    expect(calcularUso(HAIKU, undefined).custoUsd).toBe(0);
    expect(calcularUso(HAIKU, {}).custoUsd).toBe(0);
    const negativo = calcularUso(HAIKU, { input_tokens: -5, output_tokens: NaN });
    expect(negativo.tokensEntrada).toBe(0);
    expect(negativo.tokensSaida).toBe(0);
  });

  it("não arredonda a ponto de zerar uma chamada barata", () => {
    // Uma chamada real de OCR: ~1.600 tokens de imagem + ~200 de saída.
    const r = calcularUso(HAIKU, { input_tokens: 1_600, output_tokens: 200 });
    expect(r.custoUsd).toBeGreaterThan(0);
    expect(r.custoUsd).toBeCloseTo(0.0026, 4);
  });

  it("uma chamada com cache é bem mais barata que a mesma sem cache", () => {
    // O caso que a Fase 1 cria: instruções cacheadas, imagem sempre nova.
    const semCache = calcularUso(HAIKU, { input_tokens: 12_800, output_tokens: 250 });
    const comCache = calcularUso(HAIKU, {
      input_tokens: 1_600,
      cache_read_input_tokens: 1_200,
      output_tokens: 250,
    });
    expect(comCache.custoUsd!).toBeLessThan(semCache.custoUsd! / 2);
  });
});

describe("MiniMax-M3", () => {
  const M3 = "MiniMax-M3";

  it("cobra $0,30 a entrada e $1,20 a saída por milhão", () => {
    const r = calcularUso(M3, { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(r.custoUsd).toBeCloseTo(1.5, 6);
  });

  it("é bem mais barato que o Haiku, que já era o modelo barato do arranjo", () => {
    const uso = { input_tokens: 100_000, output_tokens: 5_000 };
    const haiku = calcularUso(HAIKU, uso).custoUsd!;
    const m3 = calcularUso(M3, uso).custoUsd!;
    expect(m3).toBeLessThan(haiku / 3);
  });

  it("usa o preço PRÓPRIO de cache de leitura, não os 10% da Anthropic", () => {
    // $0,06/MTok — 20% da entrada. Com o multiplicador global daria $0,03.
    const r = calcularUso(M3, { cache_read_input_tokens: 1_000_000 });
    expect(r.custoUsd).toBeCloseTo(0.06, 6);
    expect(r.custoUsd).not.toBeCloseTo(0.3 * MULT_CACHE_LEITURA, 6);
  });

  it("sem preço de escrita publicado, cai no multiplicador — e erra pra cima", () => {
    const r = calcularUso(M3, { cache_creation_input_tokens: 1_000_000 });
    expect(r.custoUsd).toBeCloseTo(0.3 * MULT_CACHE_ESCRITA_5M, 6);
  });

  it("não mudou a conta de nenhum modelo da Anthropic", () => {
    // O Haiku não declara preço próprio de cache: continua nos multiplicadores.
    const leitura = calcularUso(HAIKU, { cache_read_input_tokens: 1_000_000 });
    expect(leitura.custoUsd).toBeCloseTo(1 * MULT_CACHE_LEITURA, 6);
    const escrita1h = calcularUso(HAIKU, {
      cache_creation: { ephemeral_1h_input_tokens: 1_000_000 },
    });
    expect(escrita1h.custoUsd).toBeCloseTo(1 * MULT_CACHE_ESCRITA_1H, 6);
  });

  it("está na tabela — modelo fora dela grava tokens sem custo", () => {
    expect(PRECOS_POR_MODELO[M3]).toBeDefined();
  });
});
