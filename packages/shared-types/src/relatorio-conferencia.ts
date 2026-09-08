import { z } from "zod";
import { comPeriodoValido } from "./relatorio";

/**
 * Relatório histórico de TEMPO DE CONFERÊNCIA.
 *
 * A pergunta que ele responde é uma só: quanto tempo uma viagem espera até
 * alguém (ou algo) dizer que ela está conferida — e como isso mudou desde que a
 * conferência automática entrou.
 *
 * Duas decisões que dão o resto:
 *
 * 1. **O relógio começa em `sincronizadoEm`**, não em `data` nem em
 *    `criadoOfflineEm`. É o instante em que a viagem chegou no servidor e virou
 *    trabalho de alguém; antes disso ela estava no celular do motorista e
 *    ninguém tinha o que conferir. Contar do `criadoOfflineEm` misturaria o 4G
 *    ruim da estrada com a fila da conferência.
 *
 * 2. **Mediana, não média.** Uma viagem esquecida por 20 dias arrasta a média do
 *    mês inteiro e some com a diferença que a gente quer enxergar. A mediana diz
 *    como é o dia normal, e o p90 diz como é o dia ruim — as duas juntas contam
 *    a história que uma média sozinha esconde.
 */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

export const GranularidadeConferencia = z.enum(["MES", "SEMANA"]);
export type GranularidadeConferencia = z.infer<typeof GranularidadeConferencia>;

export const GRANULARIDADE_CONFERENCIA_LABEL: Record<GranularidadeConferencia, string> = {
  MES: "Mês",
  SEMANA: "Semana",
};

export const RelatorioConferenciaQuery = comPeriodoValido(
  z.object({
    de: ymd,
    ate: ymd,
    granularidade: GranularidadeConferencia.default("MES"),
    transportadoraId: z.string().uuid().optional(),
  }),
);
export type RelatorioConferenciaQuery = z.infer<typeof RelatorioConferenciaQuery>;

/**
 * Quem carimbou a conferência. A regra de leitura é a mesma do resto do sistema
 * (ver o cabeçalho de `aplicar-veredito.service.ts`):
 *  - `revisadoPorId` preenchido → pessoa;
 *  - nulo + `conferenciaDispensadaEm` → material que não gera papel;
 *  - nulo + `conferidoPorIaEm` → conferência automática.
 *
 * DISPENSA é categoria à parte de propósito: a viagem nasce aprovada, o tempo
 * dela é zero por definição e jogá-la no balde da IA faria o robô parecer mais
 * rápido do que é.
 */
export const ORIGENS_CONFERENCIA = ["HUMANO", "IA", "DISPENSA", "OUTRO"] as const;
export type OrigemConferencia = (typeof ORIGENS_CONFERENCIA)[number];

export const ORIGEM_CONFERENCIA_LABEL: Record<OrigemConferencia, string> = {
  HUMANO: "Conferido por pessoa",
  IA: "Conferência automática",
  DISPENSA: "Material sem ticket",
  OUTRO: "Sem origem registrada",
};

/** Estatística de tempo de um recorte. `null` quando o recorte está vazio. */
export type EstatisticaTempoConferencia = {
  n: number;
  medianaSegundos: number | null;
  p90Segundos: number | null;
  mediaSegundos: number | null;
};

export type RecorteConferencia = {
  total: number;
  /** Todas as origens juntas. */
  geral: EstatisticaTempoConferencia;
  porOrigem: Record<OrigemConferencia, EstatisticaTempoConferencia>;
};

export type PeriodoConferencia = RecorteConferencia & {
  /** "2026-08" no mês, "2026-08-17" (segunda-feira) na semana. */
  chave: string;
  /** Pronto pra eixo do gráfico: "ago/26" ou "17/08". */
  rotulo: string;
};

/**
 * Faixas da distribuição. São a foto que a mediana não dá: mostram que o "antes"
 * tinha uma cauda de dias e o "agora" se concentra em minutos.
 *
 * `limiteSegundos` é o teto EXCLUSIVO da faixa; a última é aberta (null). A
 * ordem importa — o SQL usa `width_bucket` com estes mesmos limites, então
 * mexer aqui muda o agrupamento do servidor junto.
 */
export const FAIXAS_TEMPO_CONFERENCIA = [
  { chave: "ate5min", rotulo: "até 5 min", limiteSegundos: 300 },
  { chave: "ate30min", rotulo: "5–30 min", limiteSegundos: 1_800 },
  { chave: "ate2h", rotulo: "30 min–2 h", limiteSegundos: 7_200 },
  { chave: "ate8h", rotulo: "2–8 h", limiteSegundos: 28_800 },
  { chave: "ate24h", rotulo: "8–24 h", limiteSegundos: 86_400 },
  { chave: "ate3d", rotulo: "1–3 dias", limiteSegundos: 259_200 },
  { chave: "mais3d", rotulo: "mais de 3 dias", limiteSegundos: null },
] as const;

export type FaixaTempoConferencia = {
  chave: string;
  rotulo: string;
  total: number;
  porOrigem: Record<OrigemConferencia, number>;
};

export type RelatorioConferenciaResposta = {
  periodo: { de: string; ate: string; dias: number };
  granularidade: GranularidadeConferencia;
  /** Série contínua: períodos sem conferência nenhuma vêm zerados, não faltam. */
  periodos: PeriodoConferencia[];
  totais: RecorteConferencia;
  faixas: FaixaTempoConferencia[];
  /**
   * Tempo de MÁQUINA da leitura (`ConferenciaTicket.duracaoMs`) — quanto o robô
   * leva pra ler um ticket, sem a fila.
   *
   * É outro número, não o mesmo em outra unidade: o de cima mede a espera da
   * viagem, este mede o trabalho. Vem sem custo em dólar de propósito — isso é
   * conta da plataforma e vive na tela de Conferência, não no relatório do
   * cliente.
   */
  leitura: {
    leituras: number;
    medianaMs: number | null;
    p90Ms: number | null;
    mediaMs: number | null;
  };
  meta: { geradoEm: string };
};
