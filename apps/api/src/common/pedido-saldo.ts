import { Prisma, type UnidadePedido } from "@prisma/client";
import { SEM_CONVERSAO_TEXTO, densidadeValida, toneladasParaM3 } from "./volume-material";

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
  /** Null só quando o saldo está INDISPONÍVEL (pedido em m³ sem densidade). */
  entregue: string | null;
  restante: string | null;
  /** 0 a 100, limitado em 100 mesmo quando entregou mais que o pedido. Null = indisponível. */
  percentual: number | null;
  viagens: number;
  /**
   * Pedido em m³: as toneladas efetivas que a balança registrou (o que foi
   * convertido). Vem mesmo sem densidade — o peso entregue é fato, só o volume
   * é que não dá pra afirmar.
   */
  entregueToneladas?: string;
  /** Pedido em m³: a densidade (t/m³) usada na conversão. */
  densidadeTonM3?: string | null;
  /** Por que o saldo não pôde ser calculado, em texto pra tela. Null = calculado. */
  indisponivel?: string | null;
  /** Dias corridos até o prazo, incluindo hoje. Null = sem prazo. */
  diasRestantes: number | null;
  /** Quanto por dia falta fazer pra cumprir. Null = sem prazo ou já cumprido. */
  ritmoNecessario: string | null;
  /**
   * Como está: `NO_RITMO` dá pro prazo, `APERTADO` precisa de mais que a média
   * já praticada, `ESTOURADO` passou do prazo sem cumprir, `CUMPRIDO` acabou.
   * `INDISPONIVEL` = pedido em m³ cujo material não tem densidade: não dá pra
   * dizer quanto falta, e dizer "0 entregue" seria mentir.
   */
  situacao: "CUMPRIDO" | "NO_RITMO" | "APERTADO" | "ESTOURADO" | "SEM_PRAZO" | "INDISPONIVEL";
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
  /**
   * Densidade (t/m³) do material DO PEDIDO. Só usada em pedido em m³ — as
   * viagens que abatem são filtradas pelo material do pedido, então a
   * densidade dele é a delas.
   */
  densidadeTonM3?: DecimalLike;
  /** Injetável pro teste não depender do relógio. */
  hoje?: Date;
}): SaldoPedido {
  const alvo = dec(args.quantidadeAlvo);
  const somaToneladas = () =>
    args.viagens.reduce((acc, v) => acc.add(dec(v.toneladas)), new Prisma.Decimal(0));

  let entregue: Prisma.Decimal;
  let extrasM3: Pick<SaldoPedido, "entregueToneladas" | "densidadeTonM3"> = {};
  if (args.unidadeAlvo === "M3") {
    const toneladas = somaToneladas();
    const densidade = densidadeValida(args.densidadeTonM3);
    extrasM3 = { entregueToneladas: toneladas.toFixed(3), densidadeTonM3: densidade?.toFixed(3) ?? null };
    if (!densidade) {
      // Indisponível, nunca 0: "0 de 300 m³" num pedido com 40 viagens feitas
      // faria o supervisor programar caminhão pra carga que já foi entregue.
      return {
        alvo: alvo.toFixed(3),
        entregue: null,
        restante: null,
        percentual: null,
        viagens: args.viagens.length,
        ...extrasM3,
        indisponivel: SEM_CONVERSAO_TEXTO.SEM_DENSIDADE,
        diasRestantes: null,
        ritmoNecessario: null,
        situacao: "INDISPONIVEL",
      };
    }
    // Converte viagem a viagem, e não a soma: é o mesmo m³ (arredondado em 3
    // casas) que cada viagem leva pra fatura, então pedido e fatura batem.
    entregue = args.viagens.reduce((acc, v) => {
      const r = toneladasParaM3(dec(v.toneladas), densidade);
      return r.ok ? acc.add(r.valor) : acc;
    }, new Prisma.Decimal(0));
  } else {
    entregue =
      args.unidadeAlvo === "TONELADAS" ? somaToneladas() : new Prisma.Decimal(args.viagens.length);
  }

  const restante = alvo.sub(entregue);
  const percentual = alvo.lte(0)
    ? 100
    : Math.min(100, Math.round(entregue.div(alvo).mul(100).toNumber()));

  const casas = args.unidadeAlvo === "VIAGENS" ? 0 : 3;
  const base = {
    ...extrasM3,
    indisponivel: null,
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
    ritmoNecessario: ritmo.toFixed(1),
    situacao: apertado ? "APERTADO" : "NO_RITMO",
  };
}

export const SITUACAO_PEDIDO_TEXTO: Record<SaldoPedido["situacao"], string> = {
  CUMPRIDO: "Cumprido",
  NO_RITMO: "No ritmo",
  APERTADO: "Ritmo apertado pro prazo",
  ESTOURADO: "Passou do prazo",
  SEM_PRAZO: "Sem prazo combinado",
  INDISPONIVEL: "Saldo indisponível",
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
