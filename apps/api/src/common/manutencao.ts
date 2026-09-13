/**
 * Quando a manutenção preventiva vence.
 *
 * O gatilho é por km OU por dias — **o que vencer primeiro**, que é como oficina
 * de verdade trabalha: "óleo a cada 10 mil km ou 6 meses". Tratar só um dos dois
 * deixa parado o caminhão que roda pouco (vence por tempo) ou o que roda muito
 * (vence por km) — sempre o errado.
 */

export type PlanoParaAvaliar = {
  id: string;
  descricao: string;
  intervaloKm: number | null;
  intervaloDias: number | null;
  ultimoOdometro: number | null;
  ultimaEm: Date | null;
};

export type SituacaoPlano =
  | "SEM_REFERENCIA"
  | "EM_DIA"
  | "PROXIMO"
  | "VENCIDO";

export type AvaliacaoPlano = {
  planoId: string;
  descricao: string;
  situacao: SituacaoPlano;
  /** Quanto falta de km. Negativo = passou. Null = não é por km. */
  kmRestante: number | null;
  /** Quanto falta de dias. Negativo = passou. Null = não é por tempo. */
  diasRestante: number | null;
  /** O que dispara primeiro. É a razão de o plano existir. */
  motivo: "KM" | "TEMPO" | null;
};

/**
 * A margem de "está chegando": 10% do intervalo, ou 500 km / 15 dias, o que for
 * menor.
 *
 * Percentual sozinho dá aviso cedo demais em intervalo grande (10% de 40 mil km
 * são 4 mil km de antecedência, o que vira ruído que ninguém olha). O teto fixo
 * mantém o aviso perto do evento, que é quando ele é acionável.
 */
function margemKm(intervalo: number): number {
  return Math.min(Math.round(intervalo * 0.1), 500);
}
function margemDias(intervalo: number): number {
  return Math.min(Math.round(intervalo * 0.1), 15);
}

function diasEntre(de: Date, ate: Date): number {
  const d = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return Math.round((d(ate) - d(de)) / 86_400_000);
}

/**
 * Avalia um plano contra o estado atual do caminhão.
 *
 * Sem referência (plano recém-criado, nunca executado) devolve
 * `SEM_REFERENCIA` em vez de "vencido": um plano novo não significa que a
 * manutenção está atrasada, significa que ninguém registrou a última — e marcar
 * tudo como vencido no dia da adoção faria a tela nascer vermelha e ser
 * ignorada.
 */
export function avaliarPlano(
  plano: PlanoParaAvaliar,
  atual: { odometro: number | null; hoje?: Date },
): AvaliacaoPlano {
  const hoje = atual.hoje ?? new Date();

  let kmRestante: number | null = null;
  if (plano.intervaloKm != null && plano.ultimoOdometro != null && atual.odometro != null) {
    kmRestante = plano.ultimoOdometro + plano.intervaloKm - atual.odometro;
  }

  let diasRestante: number | null = null;
  if (plano.intervaloDias != null && plano.ultimaEm != null) {
    diasRestante = plano.intervaloDias - diasEntre(plano.ultimaEm, hoje);
  }

  if (kmRestante == null && diasRestante == null) {
    return {
      planoId: plano.id,
      descricao: plano.descricao,
      situacao: "SEM_REFERENCIA",
      kmRestante: null,
      diasRestante: null,
      motivo: null,
    };
  }

  const vencidoKm = kmRestante != null && kmRestante <= 0;
  const vencidoTempo = diasRestante != null && diasRestante <= 0;
  const proximoKm =
    kmRestante != null &&
    plano.intervaloKm != null &&
    kmRestante > 0 &&
    kmRestante <= margemKm(plano.intervaloKm);
  const proximoTempo =
    diasRestante != null &&
    plano.intervaloDias != null &&
    diasRestante > 0 &&
    diasRestante <= margemDias(plano.intervaloDias);

  // O que vencer PRIMEIRO manda. Entre os dois vencidos, aponta o que estourou
  // mais — é o que o gestor quer saber pra decidir a urgência.
  let situacao: SituacaoPlano = "EM_DIA";
  let motivo: "KM" | "TEMPO" | null = null;

  if (vencidoKm || vencidoTempo) {
    situacao = "VENCIDO";
    if (vencidoKm && vencidoTempo) {
      motivo = (kmRestante ?? 0) <= (diasRestante ?? 0) ? "KM" : "TEMPO";
    } else {
      motivo = vencidoKm ? "KM" : "TEMPO";
    }
  } else if (proximoKm || proximoTempo) {
    situacao = "PROXIMO";
    motivo = proximoKm ? "KM" : "TEMPO";
  }

  return { planoId: plano.id, descricao: plano.descricao, situacao, kmRestante, diasRestante, motivo };
}

export const SITUACAO_PLANO_TEXTO: Record<SituacaoPlano, string> = {
  SEM_REFERENCIA: "Falta registrar a última execução",
  EM_DIA: "Em dia",
  PROXIMO: "Chegando a hora",
  VENCIDO: "Vencida",
};

/** O sulco mínimo legal no Brasil. Abaixo disso o pneu não pode rodar. */
export const SULCO_MINIMO_MM = 1.6;

export type SituacaoPneu = "OK" | "ATENCAO" | "CRITICO" | "SEM_MEDICAO";

/**
 * Situação do pneu pelo sulco.
 *
 * 1,6mm é o limite legal, não uma recomendação: abaixo disso é multa e o
 * caminhão pode ser retido. Por isso o "crítico" começa antes — em 3mm dá tempo
 * de programar a troca; em 1,6mm já é tarde.
 */
export function situacaoPneu(sulcoMm: number | null | undefined): SituacaoPneu {
  if (sulcoMm == null) return "SEM_MEDICAO";
  if (sulcoMm <= SULCO_MINIMO_MM) return "CRITICO";
  if (sulcoMm <= 3) return "ATENCAO";
  return "OK";
}

/**
 * Dias até o prazo de indicar o condutor da multa.
 *
 * Perder esse prazo faz a multa virar do PROPRIETÁRIO — a empresa paga e leva
 * os pontos no CNPJ. É a informação mais acionável de uma multa recém-chegada, e
 * por isso ela não fica escondida num campo qualquer.
 */
export function diasParaIndicar(prazo: Date | null, hoje: Date = new Date()): number | null {
  if (!prazo) return null;
  return diasEntre(hoje, prazo);
}
