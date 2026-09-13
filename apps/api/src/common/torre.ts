import { Prisma } from "@prisma/client";

/**
 * O que está fora do esperado numa viagem em curso.
 *
 * A régua é a própria operação, não um número inventado: "atrasado" é comparado
 * com o tempo que a frota leva naquele mesmo par de locais. Inventar um limite
 * fixo (4 horas, digamos) geraria alerta em toda viagem longa e silêncio em toda
 * viagem curta — o pior dos dois mundos.
 */

export type ViagemEmCurso = {
  id: string;
  motoristaId: string;
  motoristaNome: string;
  iniciadoEm: Date;
  localCargaNome: string | null;
  localDescargaNome: string | null;
  /** Último evento registrado, de qualquer tipo. */
  ultimoEventoEm: Date | null;
  /** Última posição de GPS recebida. */
  ultimaPosicaoEm: Date | null;
};

export type AlertaDetectado = {
  tipo: "ATRASO" | "PARADA_LONGA" | "SEM_SINAL";
  severidade: "BAIXA" | "MEDIA" | "ALTA";
  viagemId: string;
  motoristaId: string;
  titulo: string;
  detalhe: string;
  dados: Prisma.InputJsonValue;
};

/**
 * Quanto tempo uma viagem pode levar antes de virar alerta.
 *
 * Sem histórico do par de locais, não gera alerta de atraso nenhum. É
 * deliberado: chutar um limite pra um trajeto que o sistema nunca viu produziria
 * alarme falso na primeira semana de uso, e alarme falso é como se ensina o
 * supervisor a ignorar a tela.
 */
export function limiteDeAtrasoMin(
  medianaMin: number | null,
  amostras: number,
): number | null {
  // Menos de 3 viagens no par não é histórico, é coincidência.
  if (medianaMin == null || amostras < 3) return null;
  // O dobro da mediana, com piso de 60 min: um trajeto de 20 minutos que leva 45
  // não é notícia; um de 20 que leva 2 horas é.
  return Math.max(60, Math.round(medianaMin * 2));
}

const PARADA_LONGA_MIN = 120;
const SEM_SINAL_MIN = 180;

function minutosDesde(d: Date, agora: Date): number {
  return Math.floor((agora.getTime() - d.getTime()) / 60_000);
}

function humanizarMin(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Avalia uma viagem em curso e devolve os alertas que ela dispara.
 *
 * Pode devolver mais de um: uma viagem pode estar atrasada E sem sinal, e são
 * problemas diferentes — juntar os dois numa linha só esconderia um deles.
 */
export function avaliarViagem(
  v: ViagemEmCurso,
  ctx: {
    limiteAtrasoMin: number | null;
    /** Injetável pro teste não depender do relógio. */
    agora?: Date;
    /** Se a conta usa GPS. Sem tracking ligado, "sem sinal" é ruído garantido. */
    temTracking: boolean;
  },
): AlertaDetectado[] {
  const agora = ctx.agora ?? new Date();
  const alertas: AlertaDetectado[] = [];
  const emCursoMin = minutosDesde(v.iniciadoEm, agora);

  if (ctx.limiteAtrasoMin != null && emCursoMin > ctx.limiteAtrasoMin) {
    const excedente = emCursoMin - ctx.limiteAtrasoMin;
    alertas.push({
      tipo: "ATRASO",
      // Passar do dobro do limite é outra conversa: já não é trânsito, é
      // problema. A severidade é o que ordena a fila da torre.
      severidade: excedente > ctx.limiteAtrasoMin ? "ALTA" : "MEDIA",
      viagemId: v.id,
      motoristaId: v.motoristaId,
      titulo: `${v.motoristaNome} · ${humanizarMin(emCursoMin)} em viagem`,
      detalhe:
        `O normal nesse trajeto é cerca de ${humanizarMin(Math.round(ctx.limiteAtrasoMin / 2))}` +
        (v.localDescargaNome ? ` até ${v.localDescargaNome}` : "") +
        ".",
      dados: { emCursoMin, limiteMin: ctx.limiteAtrasoMin },
    });
  }

  // Parada longa: sem NENHUM evento novo há muito tempo. Usa evento e não GPS
  // porque o motorista pode estar sem sinal numa pedreira e ainda assim rodando.
  const refEvento = v.ultimoEventoEm ?? v.iniciadoEm;
  const semEventoMin = minutosDesde(refEvento, agora);
  if (semEventoMin >= PARADA_LONGA_MIN) {
    alertas.push({
      tipo: "PARADA_LONGA",
      severidade: semEventoMin >= PARADA_LONGA_MIN * 2 ? "ALTA" : "MEDIA",
      viagemId: v.id,
      motoristaId: v.motoristaId,
      titulo: `${v.motoristaNome} · ${humanizarMin(semEventoMin)} sem registrar nada`,
      detalhe: v.ultimoEventoEm
        ? "Último evento faz tempo. Pode ser fila, quebra ou esquecimento."
        : "A viagem foi iniciada e nenhum evento foi registrado desde então.",
      dados: { semEventoMin },
    });
  }

  // Sem sinal só faz sentido pra quem tem tracking ligado. Sem isso, seria um
  // alerta permanente pra frota inteira — e alerta permanente é decoração.
  if (ctx.temTracking && v.ultimaPosicaoEm) {
    const semGpsMin = minutosDesde(v.ultimaPosicaoEm, agora);
    if (semGpsMin >= SEM_SINAL_MIN) {
      alertas.push({
        tipo: "SEM_SINAL",
        severidade: "BAIXA",
        viagemId: v.id,
        motoristaId: v.motoristaId,
        titulo: `${v.motoristaNome} · sem posição há ${humanizarMin(semGpsMin)}`,
        detalhe: "Pode ser área sem cobertura, celular sem bateria ou app fechado.",
        dados: { semGpsMin },
      });
    }
  }

  return alertas;
}

/** A mediana é mais honesta que a média aqui: uma viagem de 8h não desloca tudo. */
export function medianaMinutos(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 === 0 ? Math.round((ord[meio - 1]! + ord[meio]!) / 2) : ord[meio]!;
}

/**
 * Quanto uma ocorrência com duração vale de estadia.
 *
 * A cobrança é por hora cheia iniciada, que é como se cobra estadia no Brasil —
 * 61 minutos são 2 horas. Cobrar proporcional ao minuto parece mais justo e não
 * é o que está no contrato de ninguém.
 */
export function valorDaEstadia(args: {
  iniciouEm: Date;
  terminouEm: Date | null;
  valorHora: Prisma.Decimal | string | number | null | undefined;
  /** Horas que não se cobra (franquia combinada com o cliente). */
  franquiaHoras?: number;
  agora?: Date;
}): { horas: number; horasCobradas: number; valor: string } | null {
  if (args.valorHora == null) return null;
  const fim = args.terminouEm ?? args.agora ?? new Date();
  const minutos = Math.max(0, Math.floor((fim.getTime() - args.iniciouEm.getTime()) / 60_000));
  const horas = Math.ceil(minutos / 60);
  const franquia = args.franquiaHoras ?? 0;
  const cobradas = Math.max(0, horas - franquia);
  const valorHora =
    args.valorHora instanceof Prisma.Decimal
      ? args.valorHora
      : new Prisma.Decimal(args.valorHora);
  return {
    horas,
    horasCobradas: cobradas,
    valor: valorHora.mul(cobradas).toFixed(2),
  };
}
