/**
 * Telemetria de INTERAÇÃO da tela "Nova viagem" (opt-in por motorista via flag
 * podeTelemetria). Reconstrói o que o motorista fez — o que buscou, o que a lista
 * trouxe, o que selecionou — pra diagnosticar depois (ex.: "descarga errada").
 *
 * Fina camada sobre `reportarEvento` (fire-and-forget, offline-first, nunca
 * bloqueia a UI). Quando a flag está off, `criarTelemetriaViagem` devolve um
 * objeto NO-OP — nenhum evento é emitido e o custo é zero.
 */
import { reportarEvento } from "./event-reporter";

export type TelemetriaViagem = {
  /** Campo preenchido/alterado (valor final, não por tecla). */
  campo(campo: string, valor: unknown): void;
  /** Buscou numa lista (digitou) — quantos resultados vs total. */
  busca(campo: string, query: string, resultados: number, total: number): void;
  /** Escolheu um item de uma lista. */
  selecao(
    campo: string,
    dados: {
      query?: string;
      escolhido: { id: string; label: string };
      posicao?: number;
      entreN?: number;
    },
  ): void;
  /** Diagnóstico do fluxo de descarga (o mais crítico). */
  descarga(dados: Record<string, unknown>): void;
  /** OCR do ticket preencheu campos. */
  ocr(dados: Record<string, unknown>): void;
  /** Qual opção de km o motorista escolheu (rota/sugestão/manual). */
  km(dados: Record<string, unknown>): void;
};

const NOOP: TelemetriaViagem = {
  campo() {},
  busca() {},
  selecao() {},
  descarga() {},
  ocr() {},
  km() {},
};

export function criarTelemetriaViagem(
  ativo: boolean,
  viagemClientId?: string,
): TelemetriaViagem {
  if (!ativo) return NOOP;
  const opts = viagemClientId ? { viagemClientId } : undefined;
  const emit = (tipo: string, contexto: Record<string, unknown>) =>
    void reportarEvento(tipo, contexto, opts);
  return {
    campo: (campo, valor) => emit("nv_campo", { campo, valor: resumir(valor) }),
    busca: (campo, query, resultados, total) =>
      emit("nv_busca", { campo, query, resultados, total }),
    selecao: (campo, dados) => emit("nv_selecao", { campo, ...dados }),
    descarga: (dados) => emit("nv_descarga", dados),
    ocr: (dados) => emit("nv_ocr", dados),
    km: (dados) => emit("nv_km", dados),
  };
}

/** Não guarda texto livre gigante (observação etc) — corta em 120 chars. */
function resumir(v: unknown): unknown {
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  return v;
}
