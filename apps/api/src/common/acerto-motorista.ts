import { Prisma, type TipoRemuneracao } from "@prisma/client";

/**
 * Quanto a empresa deve ao motorista no período.
 *
 * A regra tem três partes, e a ordem delas é o que evita os erros clássicos:
 *
 *   1. O que ele GANHOU pelas viagens (a regra de remuneração).
 *   2. O que ele ADIANTOU do próprio bolso e a empresa devolve (pedágio, diesel).
 *   3. O que ele DEVE (adiantamento já recebido, descontos) — lançado à mão.
 *
 * As duas primeiras esta função calcula; a terceira é digitada no painel e
 * entra como item não-automático, porque nenhuma regra sabe que houve avaria.
 */

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

function dec(v: DecimalLike): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/** A régua de pagamento já resolvida (motorista vence modalidade). */
export type RegraRemuneracao = {
  tipo: TipoRemuneracao;
  percentualFrete: DecimalLike;
  valorPorViagem: DecimalLike;
  valorPorTonelada: DecimalLike;
  valorPorKm: DecimalLike;
  valorDiaria: DecimalLike;
  reembolsaPedagio: boolean;
  reembolsaAbastecimento: boolean;
};

type FonteRemuneracao = {
  tipoRemuneracao?: TipoRemuneracao | null;
  percentualFrete?: DecimalLike;
  valorPorViagem?: DecimalLike;
  valorPorTonelada?: DecimalLike;
  valorPorKm?: DecimalLike;
  valorDiaria?: DecimalLike;
};

/**
 * Resolve a régua: o que o MOTORISTA tem vence o que a modalidade diz.
 *
 * O override é por motorista inteiro, não campo a campo: quem declara
 * `tipoRemuneracao` próprio está dizendo "meu acordo é outro", e herdar metade
 * da modalidade nesse caso produziria uma combinação que ninguém negociou.
 */
export function resolverRemuneracao(
  motorista: FonteRemuneracao | null | undefined,
  modalidade:
    | (FonteRemuneracao & { reembolsaPedagio?: boolean; reembolsaAbastecimento?: boolean })
    | null
    | undefined,
): RegraRemuneracao {
  const usaMotorista = motorista?.tipoRemuneracao != null;
  const fonte = usaMotorista ? motorista! : modalidade;

  return {
    tipo: (fonte?.tipoRemuneracao ?? "SEM_REMUNERACAO") as TipoRemuneracao,
    percentualFrete: fonte?.percentualFrete ?? null,
    valorPorViagem: fonte?.valorPorViagem ?? null,
    valorPorTonelada: fonte?.valorPorTonelada ?? null,
    valorPorKm: fonte?.valorPorKm ?? null,
    // A diária é independente do tipo, e é a ÚNICA coisa aqui que é.
    //
    // Um agregado pago por percentual também fica à disposição de obra, então
    // ela não segue o "tudo-ou-nada" das outras: vale a do motorista se ele
    // tem uma, senão a da modalidade — mesmo que ele não tenha declarado
    // `tipoRemuneracao` próprio.
    //
    // ⚠️ Antes ela só era lida através de `fonte`, e isso escondia um degrau
    // inteiro da escada: motorista com `valorDiaria` combinado mas sem régua
    // própria recebia a diária da MODALIDADE, ignorando o valor cadastrado
    // nele. A escada documentada em `AlocacaoObra.valorDiaria` é
    // modalidade → motorista → alocação, e agora é o que acontece.
    valorDiaria: motorista?.valorDiaria ?? fonte?.valorDiaria ?? modalidade?.valorDiaria ?? null,
    // Reembolso é política da empresa, não do acordo individual: mora só na
    // modalidade. Ausente = devolve (o combinado em 99% dos casos).
    reembolsaPedagio: modalidade?.reembolsaPedagio ?? true,
    reembolsaAbastecimento: modalidade?.reembolsaAbastecimento ?? true,
  };
}

export type ViagemParaAcerto = {
  id: string;
  data: Date;
  ticket: string | null;
  km: DecimalLike;
  toneladas: DecimalLike;
  /** Pedágio que o app NATIVO gravou na viagem. Ver o aviso em `pedagioDaViagem`. */
  valorPedagioTotal: DecimalLike;
  ehDiaria: boolean;
  /** Valor faturado da viagem (ViagemValor). Null = empresa sem tabela de preço. */
  valorFrete: DecimalLike;
  clienteNome?: string | null;
  /** Pedágios lançados avulsos e vinculados a esta viagem (caminho do PWA). */
  pedagios: { id: string; valor: DecimalLike; praca?: string | null }[];
};

/**
 * Um DIA de obra que o motorista registrou, indo pro acerto dele.
 *
 * Existia um buraco aqui que custava o mês inteiro: o mensal registrava os
 * dias, conferia com o contratante — e o acerto do motorista não sabia que
 * `RegistroPresenca` existia. Vinte e dois dias na obra e o extrato dele saía
 * zerado; o dono pagava por fora, de cabeça, que é exatamente o que o produto
 * foi feito pra acabar.
 */
export type DiariaObraParaAcerto = {
  registroId: string;
  data: Date;
  obraNome: string;
  /**
   * O valor combinado NESTA alocação, quando difere da régua.
   *
   * Terceiro degrau da escada (modalidade → motorista → alocação): o mesmo
   * motorista em duas obras no mesmo mês tem duas diárias diferentes, e sem
   * isto uma das duas sai errada. Null = usa a régua.
   */
  valorDiaria: DecimalLike;
};

export type AbastecimentoParaAcerto = {
  id: string;
  data: Date;
  valorTotal: DecimalLike;
  postoNome: string | null;
  /** Comboio é diesel da empresa, não do bolso dele — nunca vira reembolso. */
  emComboio: boolean;
};

export type ItemCalculado = {
  tipo:
    | "FRETE"
    | "DIARIA"
    | "REEMBOLSO_PEDAGIO"
    | "REEMBOLSO_ABASTECIMENTO";
  viagemId?: string;
  pedagioId?: string;
  abastecimentoId?: string;
  registroPresencaId?: string;
  descricao: string;
  valor: string;
};

export type AcertoCalculado = {
  itens: ItemCalculado[];
  creditos: string;
  /** Viagens que não geraram linha de frete, e por quê. Vai pra tela. */
  semRemuneracao: { viagemId: string; motivo: string }[];
};

/**
 * O pedágio de UMA viagem, de uma fonte só.
 *
 * `Viagem.valorPedagioTotal` (app nativo) e `Pedagio.valor` (PWA) são fontes
 * independentes: nenhum código escreve uma a partir da outra. Somar as duas
 * paga o mesmo pedágio duas vezes — e só pra quem usa iPhone, que é a pior
 * classe de bug: some no teste e aparece no bolso de um motorista específico.
 *
 * Prioridade pro campo da viagem quando ele existe; senão, a soma dos avulsos.
 */
export function pedagioDaViagem(v: ViagemParaAcerto): {
  valor: Prisma.Decimal;
  pedagioIds: string[];
} {
  const naViagem = dec(v.valorPedagioTotal);
  if (naViagem.gt(0)) return { valor: naViagem, pedagioIds: [] };
  const soma = v.pedagios.reduce((acc, p) => acc.add(dec(p.valor)), new Prisma.Decimal(0));
  return { valor: soma, pedagioIds: v.pedagios.map((p) => p.id) };
}

/** O DIA de um instante, em UTC — as colunas envolvidas são `@db.Date`. */
function diaChave(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtData(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  const [a, m, dia] = iso.split("-");
  return `${dia}/${m}/${a}`;
}

/** Quanto o motorista ganha por UMA viagem, pela régua. Null = a régua não cobre. */
export function remuneracaoDaViagem(
  v: ViagemParaAcerto,
  r: RegraRemuneracao,
): { valor: Prisma.Decimal } | { motivo: string } {
  // Diária tem régua própria e ignora o tipo: o caminhão ficou à disposição, e
  // pagar isso por tonelada (ou por km) daria zero num dia inteiro de trabalho.
  if (v.ehDiaria) {
    const d = dec(r.valorDiaria);
    if (d.lte(0)) return { motivo: "Sem valor de diária configurado." };
    return { valor: d };
  }

  switch (r.tipo) {
    case "PERCENTUAL_FRETE": {
      const pct = dec(r.percentualFrete);
      if (pct.lte(0)) return { motivo: "Sem percentual configurado." };
      const frete = dec(v.valorFrete);
      // Percentual de um frete que não tem preço é zero, e zero no extrato
      // parece "essa viagem não valeu nada". Prefere não gerar linha e dizer
      // que falta a tabela de preço.
      if (frete.lte(0)) {
        return { motivo: "A viagem não tem valor — falta preço cadastrado pra empresa." };
      }
      return { valor: frete.mul(pct).div(100) };
    }
    case "VALOR_POR_VIAGEM": {
      const val = dec(r.valorPorViagem);
      if (val.lte(0)) return { motivo: "Sem valor por viagem configurado." };
      return { valor: val };
    }
    case "VALOR_POR_TONELADA": {
      const val = dec(r.valorPorTonelada);
      if (val.lte(0)) return { motivo: "Sem valor por tonelada configurado." };
      return { valor: val.mul(dec(v.toneladas)) };
    }
    case "VALOR_POR_KM": {
      const val = dec(r.valorPorKm);
      if (val.lte(0)) return { motivo: "Sem valor por km configurado." };
      return { valor: val.mul(dec(v.km)) };
    }
    default:
      return { motivo: "Este motorista não é pago por viagem pelo sistema." };
  }
}

/**
 * Monta os itens automáticos do acerto: o que ele ganhou e o que adiantou.
 *
 * Descontos e adiantamentos NÃO entram aqui — são lançados à mão no painel,
 * com motivo escrito. Nenhuma regra sabe que houve avaria.
 */
export function calcularAcerto(args: {
  viagens: ViagemParaAcerto[];
  abastecimentos: AbastecimentoParaAcerto[];
  /** Pedágios do período SEM viagem vinculada (pagou e não amarrou a nada). */
  pedagiosAvulsos: { id: string; data: Date; valor: DecimalLike; praca?: string | null }[];
  /** Dias de obra do período (o mensal). Ausente = conta sem mensal. */
  diariasObra?: DiariaObraParaAcerto[];
  regra: RegraRemuneracao;
}): AcertoCalculado {
  const itens: ItemCalculado[] = [];
  const semRemuneracao: { viagemId: string; motivo: string }[] = [];
  /** Dias que já geraram diária por VIAGEM — ver o porquê lá embaixo. */
  const diasComDiariaDeViagem = new Set<string>();

  for (const v of args.viagens) {
    const r = remuneracaoDaViagem(v, args.regra);
    if ("valor" in r) {
      if (r.valor.gt(0)) {
        const ref = v.ticket ? `ticket ${v.ticket}` : (v.clienteNome ?? "viagem");
        if (v.ehDiaria) diasComDiariaDeViagem.add(diaChave(v.data));
        itens.push({
          tipo: v.ehDiaria ? "DIARIA" : "FRETE",
          viagemId: v.id,
          descricao: `${v.ehDiaria ? "Diária" : "Viagem"} ${fmtData(v.data)} · ${ref}`,
          valor: r.valor.toFixed(2),
        });
      }
    } else {
      semRemuneracao.push({ viagemId: v.id, motivo: r.motivo });
    }

    if (args.regra.reembolsaPedagio) {
      const { valor, pedagioIds } = pedagioDaViagem(v);
      if (valor.gt(0)) {
        itens.push({
          tipo: "REEMBOLSO_PEDAGIO",
          viagemId: v.id,
          // Um item por viagem mesmo quando vieram N praças: o extrato fica
          // legível, e o vínculo com a viagem é o que ele reconhece. O id do
          // pedágio só vai quando é UM só — com vários não há o que apontar.
          pedagioId: pedagioIds.length === 1 ? pedagioIds[0] : undefined,
          descricao: `Pedágio da viagem ${fmtData(v.data)}`,
          valor: valor.toFixed(2),
        });
      }
    }
  }

  /**
   * As diárias de obra.
   *
   * ⚠️ PULA O DIA QUE JÁ TEM DIÁRIA DE VIAGEM. As duas coisas medem o mesmo
   * fato — o caminhão ficou o dia à disposição — por dois caminhos diferentes
   * (uma viagem com serviço medido por período, e o registro do motorista na
   * obra). Somar as duas paga o dia em dobro, e é a MESMA armadilha do pedágio
   * em dobro logo acima: duas fontes independentes que ninguém escreve a
   * partir da outra, e o erro só aparece no bolso de um motorista específico.
   * Na dúvida vale a viagem, que é a que tem ticket e cliente pra apontar.
   */
  for (const d of args.diariasObra ?? []) {
    if (diasComDiariaDeViagem.has(diaChave(d.data))) continue;
    const valor = dec(d.valorDiaria ?? args.regra.valorDiaria);
    if (valor.lte(0)) continue;
    itens.push({
      tipo: "DIARIA",
      registroPresencaId: d.registroId,
      descricao: `Diária de obra ${fmtData(d.data)} · ${d.obraNome}`,
      valor: valor.toFixed(2),
    });
  }

  if (args.regra.reembolsaPedagio) {
    for (const p of args.pedagiosAvulsos) {
      const valor = dec(p.valor);
      if (valor.lte(0)) continue;
      itens.push({
        tipo: "REEMBOLSO_PEDAGIO",
        pedagioId: p.id,
        descricao: `Pedágio ${fmtData(p.data)}${p.praca ? ` · ${p.praca}` : ""}`,
        valor: valor.toFixed(2),
      });
    }
  }

  if (args.regra.reembolsaAbastecimento) {
    for (const a of args.abastecimentos) {
      // Comboio é diesel da empresa entregue por caminhão-tanque: ele não pagou
      // nada, então não há o que devolver.
      if (a.emComboio) continue;
      const valor = dec(a.valorTotal);
      if (valor.lte(0)) continue;
      itens.push({
        tipo: "REEMBOLSO_ABASTECIMENTO",
        abastecimentoId: a.id,
        descricao: `Abastecimento ${fmtData(a.data)}${a.postoNome ? ` · ${a.postoNome}` : ""}`,
        valor: valor.toFixed(2),
      });
    }
  }

  const creditos = itens.reduce((acc, i) => acc.add(dec(i.valor)), new Prisma.Decimal(0));
  return { itens, creditos: creditos.toFixed(2), semRemuneracao };
}

/** Tipos que são desconto. Usado pra validar sinal e exigir motivo. */
export const TIPOS_DEBITO = [
  "ADIANTAMENTO",
  "DESCONTO_AVARIA",
  "DESCONTO_MULTA",
  "DESCONTO_COMBUSTIVEL",
  "DESCONTO_OUTROS",
] as const;

export function ehDebito(tipo: string): boolean {
  return (TIPOS_DEBITO as readonly string[]).includes(tipo);
}

/** Soma o extrato. Créditos e débitos separados porque a tela mostra os dois. */
export function totalizarAcerto(itens: { valor: DecimalLike }[]): {
  creditos: string;
  debitos: string;
  liquido: string;
} {
  let creditos = new Prisma.Decimal(0);
  let debitos = new Prisma.Decimal(0);
  for (const i of itens) {
    const v = dec(i.valor);
    if (v.gte(0)) creditos = creditos.add(v);
    else debitos = debitos.add(v.abs());
  }
  return {
    creditos: creditos.toFixed(2),
    debitos: debitos.toFixed(2),
    liquido: creditos.sub(debitos).toFixed(2),
  };
}
