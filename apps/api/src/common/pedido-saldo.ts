import { Prisma, type UnidadePedido } from "@prisma/client";

/**
 * Quanto do pedido já foi entregue, e se o ritmo dá pro prazo.
 *
 * O saldo é sempre DERIVADO das viagens reais, nunca um contador incrementado.
 * Contador dessincroniza no primeiro cancelamento, na primeira viagem editada,
 * na primeira exclusão — e ninguém descobre até o cliente reclamar que faltou
 * carga. Derivar custa uma soma e nunca mente.
 */

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

function dec(v: DecimalLike): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

export type ViagemAbatida = {
  /** Toneladas EFETIVAS (pós-mínimo). Em pedido por viagem, não é usado. */
  toneladas: DecimalLike;
};

export type SaldoPedido = {
  alvo: string;
  entregue: string;
  restante: string;
  /** 0 a 100, limitado em 100 mesmo quando entregou mais que o pedido. */
  percentual: number;
  viagens: number;
  /** Dias corridos até o prazo, incluindo hoje. Null = sem prazo. */
  diasRestantes: number | null;
  /** Quanto por dia falta fazer pra cumprir. Null = sem prazo ou já cumprido. */
  ritmoNecessario: string | null;
  /**
   * Como está: `NO_RITMO` dá pro prazo, `APERTADO` precisa de mais que a média
   * já praticada, `ESTOURADO` passou do prazo sem cumprir, `CUMPRIDO` acabou.
   */
  situacao: "CUMPRIDO" | "NO_RITMO" | "APERTADO" | "ESTOURADO" | "SEM_PRAZO";
};

/** Dias corridos entre hoje e o prazo, contando hoje. Negativo = venceu. */
function diasAte(prazo: Date, hoje: Date): number {
  const d = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return Math.round((d(prazo) - d(hoje)) / 86_400_000) + 1;
}

export function calcularSaldoPedido(args: {
  quantidadeAlvo: DecimalLike;
  unidadeAlvo: UnidadePedido;
  viagens: ViagemAbatida[];
  prazoEm?: Date | null;
  /** Injetável pro teste não depender do relógio. */
  hoje?: Date;
}): SaldoPedido {
  const alvo = dec(args.quantidadeAlvo);
  const entregue =
    args.unidadeAlvo === "TONELADAS"
      ? args.viagens.reduce((acc, v) => acc.add(dec(v.toneladas)), new Prisma.Decimal(0))
      : new Prisma.Decimal(args.viagens.length);

  const restante = alvo.sub(entregue);
  const percentual = alvo.lte(0)
    ? 100
    : Math.min(100, Math.round(entregue.div(alvo).mul(100).toNumber()));

  const casas = args.unidadeAlvo === "TONELADAS" ? 3 : 0;
  const base = {
    alvo: alvo.toFixed(casas),
    entregue: entregue.toFixed(casas),
    // Restante nunca é negativo na tela: entregar 22 de 20 é "cumprido", não
    // "faltam −2", que é a frase que ninguém entende.
    restante: (restante.gt(0) ? restante : new Prisma.Decimal(0)).toFixed(casas),
    percentual,
    viagens: args.viagens.length,
  };

  if (restante.lte(0)) {
    return { ...base, diasRestantes: null, ritmoNecessario: null, situacao: "CUMPRIDO" };
  }
  if (!args.prazoEm) {
    return { ...base, diasRestantes: null, ritmoNecessario: null, situacao: "SEM_PRAZO" };
  }

  const dias = diasAte(args.prazoEm, args.hoje ?? new Date());
  if (dias <= 0) {
    return { ...base, diasRestantes: dias, ritmoNecessario: null, situacao: "ESTOURADO" };
  }

  const ritmo = restante.div(dias);

  // "Apertado" compara o ritmo que falta com o que já foi praticado: se agora
  // precisa render mais do que rendeu até aqui, não vai dar sem mudar algo. É
  // uma régua honesta — não inventa meta, usa o desempenho real do próprio
  // pedido. No primeiro dia, sem histórico, não há o que comparar.
  const diasDecorridos = Math.max(
    1,
    diasAte(args.hoje ?? new Date(), args.prazoEm) * -1 + 1,
  );
  const ritmoPraticado = entregue.gt(0) ? entregue.div(diasDecorridos) : null;
  const apertado = ritmoPraticado != null && ritmo.gt(ritmoPraticado.mul(1.2));

  return {
    ...base,
    diasRestantes: dias,
    ritmoNecessario: ritmo.toFixed(args.unidadeAlvo === "TONELADAS" ? 1 : 1),
    situacao: apertado ? "APERTADO" : "NO_RITMO",
  };
}

export const SITUACAO_PEDIDO_TEXTO: Record<SaldoPedido["situacao"], string> = {
  CUMPRIDO: "Cumprido",
  NO_RITMO: "No ritmo",
  APERTADO: "Ritmo apertado pro prazo",
  ESTOURADO: "Passou do prazo",
  SEM_PRAZO: "Sem prazo combinado",
};

export type PlanejadaParaCasar = {
  id: string;
  motoristaId: string | null;
  dataPrevista: Date;
  materialId?: string | null;
  localCargaId?: string | null;
  localDescargaId?: string | null;
};

export type ViagemParaCasar = {
  motoristaId: string;
  data: Date;
  materialId: string | null;
  localCargaId: string | null;
  localDescargaId: string | null;
};

/**
 * Acha qual viagem programada a viagem real cumpriu.
 *
 * O casamento é por motorista + dia, e depois pelo que combina de material e
 * locais. Conservador de propósito: na dúvida entre duas, escolhe a de maior
 * afinidade, e empate resolve pela mais antiga na sequência do dia. Casar
 * errado é pior que não casar — uma viagem abatendo o pedido errado faz o
 * cliente cobrar carga que ele já recebeu.
 */
export function casarPlanejada(
  candidatas: PlanejadaParaCasar[],
  viagem: ViagemParaCasar,
): PlanejadaParaCasar | null {
  const mesmoDia = (a: Date, b: Date) =>
    a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

  const elegiveis = candidatas.filter(
    (p) => p.motoristaId === viagem.motoristaId && mesmoDia(p.dataPrevista, viagem.data),
  );
  if (elegiveis.length === 0) return null;
  if (elegiveis.length === 1) return elegiveis[0]!;

  // Mais campos batendo = mais provável ser esta. Campo não preenchido no plano
  // não conta a favor nem contra: o supervisor pode ter programado sem detalhar.
  const pontos = (p: PlanejadaParaCasar) => {
    let n = 0;
    if (p.materialId && p.materialId === viagem.materialId) n += 2;
    if (p.localCargaId && p.localCargaId === viagem.localCargaId) n += 2;
    if (p.localDescargaId && p.localDescargaId === viagem.localDescargaId) n += 3;
    return n;
  };

  return [...elegiveis].sort((a, b) => pontos(b) - pontos(a))[0]!;
}
