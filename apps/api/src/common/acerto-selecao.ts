import { Prisma } from "@prisma/client";
import { ymdSaoPaulo } from "./timezone";

/**
 * O que entra em cada acerto — e o que NÃO entra de jeito nenhum.
 *
 * A regra antiga escolhia só pela data. Dois acertos com períodos que se cruzam
 * (01–15 e 01–30) pagavam a mesma viagem duas vezes, e o lançamento que chegava
 * do celular depois do acerto fechado nunca era pago. A regra daqui:
 *
 *   1. Data dentro do período (dia civil de São Paulo) — quem busca é o service.
 *   2. Item que já está em acerto FECHADO ou PAGO não entra. Nunca.
 *   3. Item que está em OUTRO acerto ABERTO é puxado pra este, com aviso
 *      ("saiu do acerto de 01/09 a 15/09") — senão um ABERTO esquecido prendia
 *      o item pra sempre.
 *   4. Nada com data ANTERIOR ao período entra sozinho: aparece na lista
 *      "Ficou de fora de acertos anteriores" e a empresa marca o que incluir.
 *
 * A identidade de um item é a `chaveDoItem`. É a mesma chave que o banco trava
 * (unique em `itens_acerto.chaveFechada`) quando o acerto fecha.
 */

export type StatusAcertoSel = "ABERTO" | "FECHADO" | "PAGO";

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

function dec(v: DecimalLike): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/** O que identifica um item do acerto (o fato operacional que ele paga). */
export type RefItemAcerto = {
  tipo: string;
  viagemId?: string | null;
  pedagioId?: string | null;
  abastecimentoId?: string | null;
};

/**
 * "FRETE:<viagem>", "PEDAGIO_VIAGEM:<viagem>", "PEDAGIO:<pedágio avulso>",
 * "ABASTECIMENTO:<abastecimento>". Null = item sem lançamento por trás
 * (adiantamento, desconto, bônus): esses não têm o que repetir.
 *
 * ⚠️ A migration `20261005200000_acerto_onda0` carimba a mesma regra em SQL.
 * Mudou aqui, muda lá.
 */
export function chaveDoItem(i: RefItemAcerto): string | null {
  if (i.tipo === "FRETE" && i.viagemId) return `FRETE:${i.viagemId}`;
  if (i.tipo === "REEMBOLSO_PEDAGIO") {
    // Pedágio da viagem leva a viagem (mesmo quando veio de UM avulso vinculado,
    // que também leva o pedagioId): quem paga é a viagem.
    if (i.viagemId) return `PEDAGIO_VIAGEM:${i.viagemId}`;
    if (i.pedagioId) return `PEDAGIO:${i.pedagioId}`;
  }
  if (i.tipo === "REEMBOLSO_ABASTECIMENTO" && i.abastecimentoId) {
    return `ABASTECIMENTO:${i.abastecimentoId}`;
  }
  return null;
}

/** "05/09" de uma coluna @db.Date (meia-noite UTC = o dia civil gravado). */
export function diaMesDeData(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "acerto de 01/09 a 15/09" — o texto que a tela mostra. */
export function rotuloDoAcerto(a: { periodoInicio: Date; periodoFim: Date }): string {
  return `acerto de ${diaMesDeData(a.periodoInicio)} a ${diaMesDeData(a.periodoFim)}`;
}

/** "DD/MM/AAAA" no relógio de São Paulo — pra colunas timestamp (abastecimento). */
export function dataBRDeInstante(d: Date): string {
  const [y, m, dia] = ymdSaoPaulo(d);
  return `${String(dia).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Onde um lançamento já está: uma linha de `itens_acerto` com o acerto dela. */
export type OcupacaoItem = {
  itemId: string;
  chave: string;
  acertoId: string;
  status: StatusAcertoSel;
  periodoInicio: Date;
  periodoFim: Date;
  automatico: boolean;
  puxadoDe?: string | null;
};

export type ResultadoSelecao<T> = {
  /** O que vai ser gravado neste acerto, com o aviso de onde veio. */
  entram: (T & { puxadoDe: string | null })[];
  /** Linhas de OUTRO acerto ABERTO que saem de lá (o item veio pra cá). */
  puxar: { itemId: string; acertoId: string; chave: string; de: string }[];
  /** Já pago ou combinado noutro acerto: não entra. */
  jaFechados: { chave: string; acertoId: string; rotulo: string }[];
  /** Incluído à mão noutro acerto ABERTO: decisão de gente, não se puxa. */
  aMaoEmOutro: { chave: string; acertoId: string; rotulo: string }[];
};

/**
 * Aplica as regras 2 e 3 sobre o que a régua calculou pro período.
 *
 * `ocupacoes` são TODAS as linhas de acerto que apontam pros mesmos lançamentos,
 * inclusive as do próprio acerto (as automáticas dele vão ser regeradas; as à
 * mão ficam, e por isso o automático não pode repetir o que já foi incluído à
 * mão).
 */
export function selecionarItensDoAcerto<T extends RefItemAcerto>(args: {
  candidatos: T[];
  acertoAtualId: string | null;
  ocupacoes: OcupacaoItem[];
}): ResultadoSelecao<T> {
  const porChave = new Map<string, OcupacaoItem[]>();
  for (const o of args.ocupacoes) {
    const lista = porChave.get(o.chave) ?? [];
    lista.push(o);
    porChave.set(o.chave, lista);
  }

  const r: ResultadoSelecao<T> = { entram: [], puxar: [], jaFechados: [], aMaoEmOutro: [] };
  const vistas = new Set<string>();

  for (const c of args.candidatos) {
    const chave = chaveDoItem(c);
    if (chave == null) {
      r.entram.push({ ...c, puxadoDe: null });
      continue;
    }
    // A régua nunca gera a mesma chave duas vezes; se gerar, a segunda é erro.
    if (vistas.has(chave)) continue;
    vistas.add(chave);

    const ocs = porChave.get(chave) ?? [];
    const doAtual = ocs.filter((o) => o.acertoId === args.acertoAtualId);
    const deOutros = ocs.filter((o) => o.acertoId !== args.acertoAtualId);

    // Incluído à mão neste mesmo acerto (veio da lista "ficou de fora"): já está.
    if (doAtual.some((o) => !o.automatico)) continue;

    const fechado = deOutros.find((o) => o.status !== "ABERTO");
    if (fechado) {
      r.jaFechados.push({ chave, acertoId: fechado.acertoId, rotulo: rotuloDoAcerto(fechado) });
      continue;
    }

    const aMao = deOutros.find((o) => !o.automatico);
    if (aMao) {
      r.aMaoEmOutro.push({ chave, acertoId: aMao.acertoId, rotulo: rotuloDoAcerto(aMao) });
      continue;
    }

    if (deOutros.length > 0) {
      const de = rotuloDoAcerto(deOutros[0]);
      for (const o of deOutros) {
        r.puxar.push({ itemId: o.itemId, acertoId: o.acertoId, chave, de: rotuloDoAcerto(o) });
      }
      r.entram.push({ ...c, puxadoDe: `Este item saiu do ${de}.` });
      continue;
    }

    // Regerar não apaga o aviso de uma puxada anterior.
    const anterior = doAtual.find((o) => o.puxadoDe)?.puxadoDe ?? null;
    r.entram.push({ ...c, puxadoDe: anterior });
  }
  return r;
}

/**
 * Lista "Ficou de fora de acertos anteriores": o que a régua pagaria e não está
 * em acerto NENHUM (de nenhum status). Quem decide incluir é a empresa.
 */
export function ficaramDeFora<T extends RefItemAcerto>(
  candidatos: T[],
  chavesEmAlgumAcerto: Set<string>,
): (T & { chave: string })[] {
  const out: (T & { chave: string })[] = [];
  const vistas = new Set<string>();
  for (const c of candidatos) {
    const chave = chaveDoItem(c);
    if (chave == null || chavesEmAlgumAcerto.has(chave) || vistas.has(chave)) continue;
    vistas.add(chave);
    out.push({ ...c, chave });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Possível pedágio em dobro (0b)
// ---------------------------------------------------------------------------

export type PedagioViagemNoAcerto = {
  itemId: string;
  viagemId: string;
  /** "YYYY-MM-DD" — o dia civil gravado na viagem. */
  dia: string;
  /** O que o motorista digitou no total da viagem. Só > 0 entra na comparação. */
  valorPedagioTotal: DecimalLike;
  valor: DecimalLike;
  descricao: string;
};

export type PedagioAvulsoNoAcerto = {
  itemId: string;
  pedagioId: string;
  dia: string;
  valor: DecimalLike;
  descricao: string;
};

export type DecisaoDobro = {
  decisao: "MESMO_PEDAGIO" | "PEDAGIOS_DIFERENTES";
  decididoPor: string | null;
  decididoEm: Date;
};

export type GrupoPedagioEmDobro = {
  dia: string;
  viagens: { itemId: string; viagemId: string; valor: string; descricao: string }[];
  avulsos: {
    itemId: string;
    pedagioId: string;
    valor: string;
    descricao: string;
    decisao: DecisaoDobro | null;
  }[];
  totalViagens: string;
  totalAvulsos: string;
  /** Avulsos ainda sem decisão. Zero = conferido. */
  pendentes: number;
};

/**
 * Motorista + dia com viagem de pedágio total > 0 E pedágio avulso sem viagem:
 * pode ser o mesmo pedágio lançado duas vezes (no finalizar e no avulso).
 * Pode também não ser — por isso é aviso, e quem decide é gente.
 *
 * O acerto é de UM motorista, então "mesmo motorista" já vem de graça.
 */
export function detectarPedagioEmDobro(args: {
  viagens: PedagioViagemNoAcerto[];
  avulsos: PedagioAvulsoNoAcerto[];
  decisoes: Map<string, DecisaoDobro>;
}): GrupoPedagioEmDobro[] {
  const viagensPorDia = new Map<string, PedagioViagemNoAcerto[]>();
  for (const v of args.viagens) {
    if (!dec(v.valorPedagioTotal).gt(0)) continue;
    const l = viagensPorDia.get(v.dia) ?? [];
    l.push(v);
    viagensPorDia.set(v.dia, l);
  }
  const avulsosPorDia = new Map<string, PedagioAvulsoNoAcerto[]>();
  for (const a of args.avulsos) {
    const l = avulsosPorDia.get(a.dia) ?? [];
    l.push(a);
    avulsosPorDia.set(a.dia, l);
  }

  const grupos: GrupoPedagioEmDobro[] = [];
  for (const [dia, vs] of viagensPorDia) {
    const as = avulsosPorDia.get(dia);
    if (!as || as.length === 0) continue;
    const avulsos = as.map((a) => ({
      itemId: a.itemId,
      pedagioId: a.pedagioId,
      valor: dec(a.valor).toFixed(2),
      descricao: a.descricao,
      decisao: args.decisoes.get(a.pedagioId) ?? null,
    }));
    grupos.push({
      dia,
      viagens: vs.map((v) => ({
        itemId: v.itemId,
        viagemId: v.viagemId,
        valor: dec(v.valor).toFixed(2),
        descricao: v.descricao,
      })),
      avulsos,
      totalViagens: vs.reduce((s, v) => s.add(dec(v.valor)), new Prisma.Decimal(0)).toFixed(2),
      totalAvulsos: as.reduce((s, a) => s.add(dec(a.valor)), new Prisma.Decimal(0)).toFixed(2),
      pendentes: avulsos.filter((a) => a.decisao == null).length,
    });
  }
  return grupos.sort((a, b) => a.dia.localeCompare(b.dia));
}
