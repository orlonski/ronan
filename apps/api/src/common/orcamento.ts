import { Prisma, type BasePreco, type StatusOrcamento, type UnidadePedido } from "@prisma/client";
import { tabelaPrecoAplicada, type TabelaPrecoRow } from "./viagem-preco";
import { densidadeValida } from "./volume-material";

/**
 * Regras puras do orçamento (proposta comercial que vira pedido).
 *
 * O orçamento é PROPOSTA: o total aqui é estimativa pro cliente decidir, não
 * faturamento. Por isso não passa pela `RegraMinimo` — mínimo é regra de
 * faturar viagem rodada, e a proposta ainda não tem viagem nenhuma. O que vale
 * dinheiro de verdade continua sendo `viagem-preco.ts`.
 */

type DecimalLike = Prisma.Decimal | string | number;
const dec = (v: DecimalLike) => (v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v));

// ─────────────────────────────── total ───────────────────────────────

export type ItemParaValor = {
  quantidade: DecimalLike;
  unidade: UnidadePedido;
  base: BasePreco;
  precoUnitario: DecimalLike;
  kmEstimado?: DecimalLike | null;
  densidadeTonM3?: DecimalLike | null;
};

export type MotivoSemValor = "SEM_DENSIDADE" | "SEM_KM" | "UNIDADE_INCOMPATIVEL";

export const SEM_VALOR_TEXTO: Record<MotivoSemValor, string> = {
  SEM_DENSIDADE: "o material não tem densidade cadastrada pra converter t ↔ m³",
  SEM_KM: "preço por km sem a distância da rota",
  UNIDADE_INCOMPATIVEL: "a quantidade não está na unidade do preço (ex.: toneladas com preço por viagem)",
};

/**
 * Quanto vale UMA linha. A quantidade e o preço podem estar em unidades
 * diferentes (pedido em m³ com preço por tonelada); converte pela densidade do
 * material quando dá. Quando NÃO dá, devolve o motivo e nenhum número — nunca
 * zero, porque zero numa proposta parece cortesia.
 *
 * Preço por km multiplica o km da rota POR VIAGEM, então só fecha conta com a
 * quantidade em viagens (mesma régua da `viagem-preco`: km × preço = 1 viagem).
 */
export function valorItem(
  item: ItemParaValor,
): { valor: Prisma.Decimal; quantidadeNaBase: Prisma.Decimal } | { valor: null; motivo: MotivoSemValor } {
  const qtd = dec(item.quantidade);
  const preco = dec(item.precoUnitario);
  const densidade = densidadeValida(item.densidadeTonM3);

  let naBase: Prisma.Decimal;
  switch (item.base) {
    case "VIAGEM":
      if (item.unidade !== "VIAGENS") return { valor: null, motivo: "UNIDADE_INCOMPATIVEL" };
      naBase = qtd;
      break;
    case "KM":
      if (item.unidade !== "VIAGENS") return { valor: null, motivo: "UNIDADE_INCOMPATIVEL" };
      if (item.kmEstimado == null || dec(item.kmEstimado).lte(0)) return { valor: null, motivo: "SEM_KM" };
      naBase = qtd.mul(dec(item.kmEstimado));
      break;
    case "TONELADA":
      if (item.unidade === "TONELADAS") naBase = qtd;
      else if (item.unidade === "M3") {
        if (!densidade) return { valor: null, motivo: "SEM_DENSIDADE" };
        naBase = qtd.mul(densidade);
      } else return { valor: null, motivo: "UNIDADE_INCOMPATIVEL" };
      break;
    case "M3":
      if (item.unidade === "M3") naBase = qtd;
      else if (item.unidade === "TONELADAS") {
        if (!densidade) return { valor: null, motivo: "SEM_DENSIDADE" };
        // Mesmas 3 casas do volume no banco, pra a conta bater com a viagem.
        naBase = qtd.div(densidade).toDecimalPlaces(3);
      } else return { valor: null, motivo: "UNIDADE_INCOMPATIVEL" };
      break;
    default:
      return { valor: null, motivo: "UNIDADE_INCOMPATIVEL" };
  }
  return { valor: naBase.mul(preco).toDecimalPlaces(2), quantidadeNaBase: naBase };
}

/**
 * Total da proposta. Item sem valor calculável não entra na soma, e a conta
 * diz quantos ficaram de fora — o PDF avisa em vez de mostrar um total menor
 * como se fosse o inteiro.
 */
export function totalOrcamento(itens: ItemParaValor[]): { total: string; itensSemValor: number } {
  let total = new Prisma.Decimal(0);
  let itensSemValor = 0;
  for (const it of itens) {
    const r = valorItem(it);
    if (r.valor == null) itensSemValor++;
    else total = total.add(r.valor);
  }
  return { total: total.toFixed(2), itensSemValor };
}

// ─────────────────────────── sugestão de preço ───────────────────────────

/**
 * O preço da tabela vigente do cliente pra este item. É a MESMA resolução da
 * fatura (`tabelaPrecoAplicada`): sugerir uma linha que a fatura não usaria
 * seria prometer um preço e cobrar outro.
 *
 * Sem km (rota desconhecida), só serve linha que vale pra QUALQUER distância
 * (faixa 0 → sem teto); chutar km 0 casaria a faixa curta e sugeriria o preço
 * errado com cara de certo. Prospect não tem tabela: sem sugestão.
 */
export function sugerirPrecoItem(
  tabelas: TabelaPrecoRow[],
  args: {
    empresaId: string | null | undefined;
    materialId: string | null;
    tipoServicoId: string | null;
    kmEstimado: DecimalLike | null;
    hoje: string;
  },
): { linha: TabelaPrecoRow; motivo?: never } | { linha: null; motivo: string } {
  if (!args.empresaId) return { linha: null, motivo: "Cliente ainda não cadastrado: não há tabela de preço dele." };
  const candidatas =
    args.kmEstimado == null
      ? tabelas.filter((t) => dec(t.kmFaixaDe).eq(0) && t.kmFaixaAte == null)
      : tabelas;
  const linha = tabelaPrecoAplicada(candidatas, {
    empresaId: args.empresaId,
    materialId: args.materialId,
    tipoServicoId: args.tipoServicoId,
    kmReal: args.kmEstimado ?? 0,
    data: args.hoje,
  });
  if (linha) return { linha };
  return {
    linha: null,
    motivo:
      args.kmEstimado == null && tabelas.some((t) => t.empresaId === args.empresaId)
        ? "A tabela do cliente é por faixa de km e a rota não tem distância — informe o preço."
        : "Nenhum preço da tabela do cliente serve pra este item.",
  };
}

// ─────────────────────────────── ciclo ───────────────────────────────

/** `validadeEm` é inclusivo: a proposta vale até o fim daquele dia (SP). */
export function passouDaValidade(validadeEm: Date | string, hoje: string): boolean {
  const v = typeof validadeEm === "string" ? validadeEm.slice(0, 10) : validadeEm.toISOString().slice(0, 10);
  return v < hoje;
}

/** O que o cron diário marca VENCIDO. Aprovado e recusado já têm resposta. */
export function deveVencer(status: StatusOrcamento, validadeEm: Date | string, hoje: string): boolean {
  return (status === "RASCUNHO" || status === "ENVIADO") && passouDaValidade(validadeEm, hoje);
}

/**
 * VENCIDO é editável de propósito: o cliente responde no dia seguinte, a
 * pessoa prorroga a validade e a proposta volta a valer. APROVADO e RECUSADO
 * são história — mudar depois reescreveria o que foi combinado.
 */
export const podeEditar = (s: StatusOrcamento) => s === "RASCUNHO" || s === "ENVIADO" || s === "VENCIDO";
export const podeAprovar = (s: StatusOrcamento) => s === "RASCUNHO" || s === "ENVIADO";
export const podeRecusar = (s: StatusOrcamento) => s === "RASCUNHO" || s === "ENVIADO" || s === "VENCIDO";
/** Só rascunho some: o que já foi pro cliente fica, nem que seja como recusado. */
export const podeExcluir = (s: StatusOrcamento) => s === "RASCUNHO";

/** Status depois de salvar uma edição. Vencido com validade nova volta a rascunho. */
export function statusAposEditar(atual: StatusOrcamento, novaValidade: string, hoje: string): StatusOrcamento {
  if (atual === "VENCIDO" && !passouDaValidade(novaValidade, hoje)) return "RASCUNHO";
  return atual;
}

// ─────────────────────────── conversão em pedido ───────────────────────────

export type ItemParaPedido = {
  id: string;
  materialId: string | null;
  tipoServicoId: string | null;
  localCargaId: string | null;
  localDescargaId: string | null;
  descricao: string | null;
  quantidade: DecimalLike;
  unidade: UnidadePedido;
};

export type PedidoDoItem = {
  itemId: string;
  empresaId: string;
  clienteId: string | null;
  materialId: string | null;
  tipoServicoId: string | null;
  localCargaId: string | null;
  localDescargaId: string | null;
  quantidadeAlvo: Prisma.Decimal;
  unidadeAlvo: UnidadePedido;
  inicioEm: string;
  prazoEm: string | null;
  observacao: string;
};

const ymd = (d: Date | string | null | undefined) =>
  d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Um pedido por item. A quantidade e a unidade do pedido são as da PROPOSTA
 * (o que o cliente comprou), não a base do preço — o saldo do pedido mede
 * entrega, não dinheiro.
 *
 * Início: o previsto na proposta, ou hoje. Prazo: o da proposta, descartado se
 * ficar antes do início (proposta aprovada atrasada não pode gerar pedido
 * inválido — o pedido recusaria).
 */
export function itensParaPedidos(
  orc: { numero: number; inicioPrevistoEm: Date | string | null; prazoEm: Date | string | null },
  itens: ItemParaPedido[],
  alvo: { empresaId: string; clienteId: string | null; hoje: string },
): PedidoDoItem[] {
  const inicioEm = ymd(orc.inicioPrevistoEm) ?? alvo.hoje;
  const prazo = ymd(orc.prazoEm);
  const prazoEm = prazo && prazo >= inicioEm ? prazo : null;
  return itens.map((it) => ({
    itemId: it.id,
    empresaId: alvo.empresaId,
    clienteId: alvo.clienteId,
    materialId: it.materialId,
    tipoServicoId: it.tipoServicoId,
    localCargaId: it.localCargaId,
    localDescargaId: it.localDescargaId,
    quantidadeAlvo: dec(it.quantidade),
    unidadeAlvo: it.unidade,
    inicioEm,
    prazoEm,
    observacao: `Do orçamento nº ${orc.numero}${it.descricao ? ` — ${it.descricao}` : ""}`.slice(0, 1000),
  }));
}

// ─────────────────────── preço aprovado → tabela do cliente ───────────────────────

export type LinhaTabelaExistente = {
  id: string;
  materialId: string | null;
  tipoServicoId: string | null;
  kmFaixaDe: DecimalLike;
  kmFaixaAte: DecimalLike | null;
  base: BasePreco;
  precoUnitario: DecimalLike;
  vigenciaDe: Date | string;
  vigenciaAte: Date | string | null;
  ativo: boolean;
};

export type PlanoTabela =
  | { acao: "NADA"; motivo: string }
  | { acao: "ERRO"; motivo: string }
  | {
      acao: "CRIAR";
      /** Linhas que deixam de valer ontem (o preço delas NÃO muda). */
      fechar: { id: string; vigenciaAte: string }[];
      criar: { kmFaixaDe: string; kmFaixaAte: string | null; vigenciaDe: string };
    };

function ontemDe(hoje: string): string {
  return new Date(Date.parse(`${hoje}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Leva o preço aprovado pra tabela do cliente, respeitando a vigência:
 *
 * - NUNCA edita o preço de uma linha que está valendo. Cria uma linha NOVA,
 *   vigente a partir de hoje; a antiga ganha fim de vigência ontem e segue
 *   explicando as viagens que já rodaram com ela.
 * - A faixa de km é a da linha que o item casaria hoje (troca o preço daquela
 *   faixa, não da tabela inteira). Sem linha que case, ocupa o vão em volta do
 *   km do item entre as faixas que existem — nunca cruza outra faixa.
 * - Linha que começa hoje ou no futuro não é fechada: alguém já agendou um
 *   reajuste, e passar por cima disso é decisão pra tela da tabela, não daqui.
 */
export function planoTabelaPreco(
  existentes: LinhaTabelaExistente[],
  item: {
    materialId: string | null;
    tipoServicoId: string | null;
    kmEstimado: DecimalLike | null;
    base: BasePreco;
    precoUnitario: DecimalLike;
  },
  hoje: string,
  opts: { criadasAgora?: string[] } = {},
): PlanoTabela {
  const vigenteOuFutura = (l: LinhaTabelaExistente) => {
    const ate = ymd(l.vigenciaAte);
    return l.ativo && (ate == null || ate >= hoje);
  };
  // Mesmo alvo da checagem de sobreposição da tela da tabela: material e modo
  // EXATOS (null casa só com null).
  const doAlvo = existentes.filter(
    (l) =>
      vigenteOuFutura(l) &&
      (l.materialId ?? null) === (item.materialId ?? null) &&
      (l.tipoServicoId ?? null) === (item.tipoServicoId ?? null),
  );

  const km = item.kmEstimado == null ? null : dec(item.kmEstimado);
  const cobre = (l: LinhaTabelaExistente, k: Prisma.Decimal) =>
    dec(l.kmFaixaDe).lte(k) && (l.kmFaixaAte == null || k.lt(dec(l.kmFaixaAte)));

  let faixaDe: Prisma.Decimal;
  let faixaAte: Prisma.Decimal | null;
  if (km == null) {
    // Sem distância, a única faixa honesta é "qualquer km" — e só se ela não
    // cruzar faixa nenhuma que já exista.
    const temOutraFaixa = doAlvo.some((l) => !(dec(l.kmFaixaDe).eq(0) && l.kmFaixaAte == null));
    if (temOutraFaixa) {
      return {
        acao: "ERRO",
        motivo:
          "A tabela desse cliente é dividida por faixa de km, e o item não tem a distância da rota. Cadastre o preço pela tela de Tabela de preço.",
      };
    }
    faixaDe = new Prisma.Decimal(0);
    faixaAte = null;
  } else {
    const casa = doAlvo.find((l) => cobre(l, km) && ymd(l.vigenciaDe)! <= hoje);
    if (casa) {
      faixaDe = dec(casa.kmFaixaDe);
      faixaAte = casa.kmFaixaAte == null ? null : dec(casa.kmFaixaAte);
    } else {
      // O vão em volta do km: do fim da faixa anterior até o começo da próxima.
      faixaDe = new Prisma.Decimal(0);
      faixaAte = null;
      for (const l of doAlvo) {
        const de = dec(l.kmFaixaDe);
        const ate = l.kmFaixaAte == null ? null : dec(l.kmFaixaAte);
        if (ate != null && ate.lte(km) && ate.gt(faixaDe)) faixaDe = ate;
        if (de.gt(km) && (faixaAte == null || de.lt(faixaAte))) faixaAte = de;
      }
    }
  }

  const cruza = (l: LinhaTabelaExistente) => {
    const de = dec(l.kmFaixaDe);
    const ate = l.kmFaixaAte == null ? null : dec(l.kmFaixaAte);
    const fimNovo = faixaAte;
    return (fimNovo == null || de.lt(fimNovo)) && (ate == null || faixaDe.lt(ate));
  };
  const preco = dec(item.precoUnitario);
  // Dois itens da MESMA proposta na mesma faixa (ex.: brita em t e em m³): o
  // segundo enxerga a linha que o primeiro acabou de criar, começando hoje.
  // Mesmo preço = já foi; preço diferente = a proposta se contradiz, e a
  // tabela só comporta um preço por faixa.
  const criadasAgora = new Set(opts.criadasAgora ?? []);
  const irma = doAlvo.find((l) => criadasAgora.has(l.id) && cruza(l));
  if (irma) {
    return irma.base === item.base && dec(irma.precoUnitario).eq(preco)
      ? { acao: "NADA", motivo: "Mesmo preço de outro item desta proposta, já levado pra tabela." }
      : {
          acao: "ERRO",
          motivo:
            "Dois itens desta proposta têm preços diferentes pra mesma faixa de km, e a tabela só guarda um. Leve um só, ou ajuste pela tela de Tabela de preço.",
        };
  }
  const conflitantes = doAlvo.filter(cruza);

  const futura = conflitantes.find((l) => ymd(l.vigenciaDe)! >= hoje);
  if (futura) {
    return {
      acao: "ERRO",
      motivo: `Já existe um preço pra essa faixa começando em ${ymd(futura.vigenciaDe)!.split("-").reverse().join("/")}. Ajuste pela tela de Tabela de preço.`,
    };
  }

  if (
    conflitantes.length === 1 &&
    conflitantes[0]!.base === item.base &&
    dec(conflitantes[0]!.precoUnitario).eq(preco)
  ) {
    return { acao: "NADA", motivo: "A tabela do cliente já tem exatamente esse preço." };
  }

  return {
    acao: "CRIAR",
    fechar: conflitantes.map((l) => ({ id: l.id, vigenciaAte: ontemDe(hoje) })),
    criar: {
      kmFaixaDe: faixaDe.toFixed(2),
      kmFaixaAte: faixaAte == null ? null : faixaAte.toFixed(2),
      vigenciaDe: hoje,
    },
  };
}
