import { z } from "zod";

/** Contas a receber, a pagar e a fatura que liga o fechamento ao dinheiro. */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

export const STATUS_FATURA = ["RASCUNHO", "EMITIDA", "ENVIADA", "CANCELADA"] as const;
export const STATUS_TITULO = ["ABERTO", "PARCIAL", "PAGO", "CANCELADO"] as const;
export const TIPOS_FORNECEDOR = [
  "POSTO",
  "OFICINA",
  "PNEU",
  "SEGURADORA",
  "PEDAGIO",
  "OUTRO",
] as const;

export const StatusFaturaSchema = z.enum(STATUS_FATURA);
export const StatusTituloSchema = z.enum(STATUS_TITULO);
export const TipoFornecedorSchema = z.enum(TIPOS_FORNECEDOR);
export type StatusFaturaTipo = z.infer<typeof StatusFaturaSchema>;
export type StatusTituloTipo = z.infer<typeof StatusTituloSchema>;
export type TipoFornecedorTipo = z.infer<typeof TipoFornecedorSchema>;

export const STATUS_TITULO_LABEL: Record<StatusTituloTipo, string> = {
  ABERTO: "Em aberto",
  PARCIAL: "Pago em parte",
  PAGO: "Pago",
  CANCELADO: "Cancelado",
};

export const STATUS_FATURA_LABEL: Record<StatusFaturaTipo, string> = {
  RASCUNHO: "Rascunho",
  EMITIDA: "Emitida",
  ENVIADA: "Enviada ao cliente",
  CANCELADA: "Cancelada",
};

export const TIPO_FORNECEDOR_LABEL: Record<TipoFornecedorTipo, string> = {
  POSTO: "Posto",
  OFICINA: "Oficina",
  PNEU: "Borracharia / pneus",
  SEGURADORA: "Seguradora",
  PEDAGIO: "Pedágio",
  OUTRO: "Outro",
};

export const FAIXAS_AGING = [
  "A_VENCER",
  "VENCE_HOJE",
  "ATE_15",
  "DE_16_A_30",
  "DE_31_A_60",
  "ACIMA_60",
] as const;
export type FaixaAgingTipo = (typeof FAIXAS_AGING)[number];

export const AGING_LABEL_UI: Record<FaixaAgingTipo, string> = {
  A_VENCER: "A vencer",
  VENCE_HOJE: "Vence hoje",
  ATE_15: "Até 15 dias",
  DE_16_A_30: "16 a 30 dias",
  DE_31_A_60: "31 a 60 dias",
  ACIMA_60: "Mais de 60 dias",
};

/**
 * Gera a fatura de um fechamento conferido.
 *
 * É o caminho normal: o fechamento vira cobrança. Faturar avulso existe pro
 * que não passou por fechamento (estadia, reentrega, serviço fora do contrato).
 */
export const GerarFaturaInput = z
  .object({
    empresaId: z.string().uuid(),
    /** Quando vem de um fechamento conferido. */
    fechamentoId: z.string().uuid().nullish(),
    periodoInicio: DATA,
    periodoFim: DATA,
    /** Em quantas vezes. O vencimento sai do prazo da empresa. */
    parcelas: z.number().int().min(1).max(12).default(1),
    /** Sobrescreve o prazo cadastrado na empresa, quando for o caso. */
    prazoDias: z.number().int().min(0).max(365).nullish(),
    observacao: z.string().trim().max(500).nullish(),
    /**
     * Estadias (paradas com valor/hora) que entram como linha da fatura. A
     * prévia sugere todas as encerradas; quem fatura desmarca o que não cobra.
     */
    estadias: z.array(z.string().min(1).max(64)).max(500).default([]),
  })
  .refine((d) => d.periodoFim >= d.periodoInicio, {
    message: "O fim do período não pode ser antes do início.",
    path: ["periodoFim"],
  });
export type GerarFaturaInput = z.infer<typeof GerarFaturaInput>;

/** O que entraria numa fatura: mesma regra do gerar, sem gravar nada. */
export const PreviaFaturaQuery = z
  .object({ empresaId: z.string().uuid(), periodoInicio: DATA, periodoFim: DATA })
  .refine((d) => d.periodoFim >= d.periodoInicio, {
    message: "O fim do período não pode ser antes do início.",
    path: ["periodoFim"],
  });
export type PreviaFaturaQuery = z.infer<typeof PreviaFaturaQuery>;

export const AtualizarFaturaInput = z.object({
  status: StatusFaturaSchema.optional(),
  documentoNumero: z.string().trim().max(30).nullish(),
  documentoChave: z.string().trim().max(60).nullish(),
  observacao: z.string().trim().max(500).nullish(),
});
export type AtualizarFaturaInput = z.infer<typeof AtualizarFaturaInput>;

/**
 * Dar baixa num título.
 *
 * Valor sempre positivo e menor ou igual ao saldo: baixa maior que a dívida é
 * quase sempre dedo errado, e aceitar calado faz o relatório mentir.
 */
export const DarBaixaInput = z.object({
  valor: z.number().positive().max(9999999.99),
  data: DATA.optional(),
  meio: z.string().trim().min(2).max(40).default("PIX"),
  observacao: z.string().trim().max(300).nullish(),
});
export type DarBaixaInput = z.infer<typeof DarBaixaInput>;

/** Conta a pagar lançada errado ou que não vai ser paga (o serviço não aconteceu). */
export const CancelarTituloPagarInput = z.object({
  motivo: z.string().trim().min(3, "Diga por que a conta foi cancelada.").max(300),
});
export type CancelarTituloPagarInput = z.infer<typeof CancelarTituloPagarInput>;

/** Conta a pagar lançada à mão: oficina, posto, seguro, parcela. */
export const CriarTituloPagarInput = z
  .object({
    descricao: z.string().trim().min(3).max(200),
    valor: z.number().positive().max(9999999.99),
    emissao: DATA.optional(),
    vencimento: DATA,
    /** No máximo UM destes. O backend recusa se vier mais de um. */
    motoristaId: z.string().uuid().nullish(),
    transportadoraId: z.string().uuid().nullish(),
    fornecedorId: z.string().uuid().nullish(),
    /** Pra custo entrar no cálculo por veículo. */
    veiculoId: z.string().uuid().nullish(),
    observacao: z.string().trim().max(300).nullish(),
  })
  .refine(
    (d) =>
      [d.motoristaId, d.transportadoraId, d.fornecedorId].filter(Boolean).length <= 1,
    {
      message: "Escolha só um: motorista, frota ou fornecedor.",
      path: ["fornecedorId"],
    },
  );
export type CriarTituloPagarInput = z.infer<typeof CriarTituloPagarInput>;

export const CriarFornecedorInput = z.object({
  nome: z.string().trim().min(2).max(120),
  cnpjCpf: z.string().trim().max(20).nullish(),
  tipo: TipoFornecedorSchema.default("OUTRO"),
  telefone: z.string().trim().max(20).nullish(),
  observacao: z.string().trim().max(300).nullish(),
});
export type CriarFornecedorInput = z.infer<typeof CriarFornecedorInput>;

export const AtualizarFornecedorInput = CriarFornecedorInput.partial().extend({
  ativo: z.boolean().optional(),
});
export type AtualizarFornecedorInput = z.infer<typeof AtualizarFornecedorInput>;

/** Custo fixo recorrente do veículo: IPVA, seguro, parcela, depreciação. */
export const CriarCustoFixoInput = z
  .object({
    veiculoId: z.string().uuid(),
    tipo: z.string().trim().min(2).max(40),
    valorMensal: z.number().positive().max(999999.99),
    vigenciaDe: DATA,
    vigenciaAte: DATA.nullish(),
    observacao: z.string().trim().max(300).nullish(),
  })
  .refine((d) => !d.vigenciaAte || d.vigenciaAte >= d.vigenciaDe, {
    message: "O fim da vigência não pode ser antes do início.",
    path: ["vigenciaAte"],
  });
export type CriarCustoFixoInput = z.infer<typeof CriarCustoFixoInput>;

/** Tipos de custo fixo que quase toda transportadora tem. Sugestão, não trava. */
export const TIPOS_CUSTO_FIXO = [
  "IPVA",
  "SEGURO",
  "FINANCIAMENTO",
  "DEPRECIACAO",
  "RASTREADOR",
  "LICENCIAMENTO",
  // Motorista registrado não é pago por viagem: o salário dele é custo do
  // caminhão que ele dirige, e é por aqui que entra no lucro por caminhão.
  "SALARIO_MOTORISTA",
  "OUTRO",
] as const;

export const TIPO_CUSTO_FIXO_LABEL: Record<(typeof TIPOS_CUSTO_FIXO)[number], string> = {
  IPVA: "IPVA",
  SEGURO: "Seguro",
  FINANCIAMENTO: "Parcela do financiamento",
  DEPRECIACAO: "Depreciação",
  RASTREADOR: "Rastreador",
  LICENCIAMENTO: "Licenciamento",
  SALARIO_MOTORISTA: "Salário do motorista",
  OUTRO: "Outro",
};

/**
 * Fechar a vigência de um custo que parou (seguro vencido, caminhão quitado).
 * Apagar a linha apagaria junto os meses em que ele valeu, e o lucro do passado
 * mudaria sozinho.
 */
export const EncerrarCustoFixoInput = z.object({ vigenciaAte: DATA });
export type EncerrarCustoFixoInput = z.infer<typeof EncerrarCustoFixoInput>;

// ---------------------------------------------------------------- em lote --

/**
 * Custos fixos de vários caminhões de uma vez — pela tela ("o mesmo seguro pra
 * estes 20") ou colando linhas de uma planilha. Uma frota de 56 caminhões não
 * cadastra IPVA página por página, e custo fixo faltando faz o lucro por
 * caminhão sair maior do que é.
 *
 * É TUDO OU NADA: com qualquer linha errada nada é gravado. Meio lote gravado
 * deixaria a pessoa sem saber o que reenviar.
 */
export const ItemLoteCustoFixo = z.object({
  /** Placa como a pessoa escreveu ("abc-1d23" vale): o servidor compara sem pontuação. */
  placa: z.string().trim().min(1).max(10),
  tipo: z.enum(TIPOS_CUSTO_FIXO),
  valorMensal: z.number().positive().max(999999.99),
  vigenciaDe: DATA,
});
export type ItemLoteCustoFixo = z.infer<typeof ItemLoteCustoFixo>;

export const LoteCustoFixoInput = z.object({
  /** true = só confere e devolve o que aconteceria, sem gravar. */
  simular: z.boolean().default(true),
  itens: z.array(ItemLoteCustoFixo).min(1).max(500),
});
export type LoteCustoFixoInput = z.infer<typeof LoteCustoFixoInput>;

/**
 * O que acontece com cada linha:
 * - NOVO: o caminhão não tinha esse custo valendo.
 * - SUBSTITUI: tinha, com outro valor — o antigo é encerrado na véspera e o
 *   novo começa na data (seguro renovado, parcela reajustada). O passado fica.
 * - IGUAL: já está cadastrado exatamente assim. Nada a fazer.
 * - ERRO: não grava nada do lote enquanto houver uma destas.
 */
export type SituacaoLoteCustoFixo = "NOVO" | "SUBSTITUI" | "IGUAL" | "ERRO";

export type ResultadoItemLoteCustoFixo = ItemLoteCustoFixo & {
  situacao: SituacaoLoteCustoFixo;
  mensagem?: string;
  /** Placa como está no cadastro, quando achou o caminhão. */
  placaCadastro?: string;
  /** O custo que será encerrado, quando SUBSTITUI. */
  anterior?: { valorMensal: string; vigenciaDe: string };
};

export type ResultadoLoteCustoFixo = {
  gravado: boolean;
  itens: ResultadoItemLoteCustoFixo[];
  resumo: Record<SituacaoLoteCustoFixo, number>;
};

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Como as pessoas escrevem cada tipo numa planilha. */
const SINONIMOS_TIPO: Record<string, (typeof TIPOS_CUSTO_FIXO)[number]> = {
  ipva: "IPVA",
  seguro: "SEGURO",
  "seguro do caminhao": "SEGURO",
  financiamento: "FINANCIAMENTO",
  parcela: "FINANCIAMENTO",
  "parcela do financiamento": "FINANCIAMENTO",
  prestacao: "FINANCIAMENTO",
  consorcio: "FINANCIAMENTO",
  depreciacao: "DEPRECIACAO",
  rastreador: "RASTREADOR",
  rastreamento: "RASTREADOR",
  licenciamento: "LICENCIAMENTO",
  salario: "SALARIO_MOTORISTA",
  "salario do motorista": "SALARIO_MOTORISTA",
  "salario motorista": "SALARIO_MOTORISTA",
  salario_motorista: "SALARIO_MOTORISTA",
  outro: "OUTRO",
  outros: "OUTRO",
};

export function tipoCustoFixoDoTexto(s: string): (typeof TIPOS_CUSTO_FIXO)[number] | null {
  return SINONIMOS_TIPO[semAcento(s)] ?? null;
}

/** "R$ 1.234,56", "1234,56", "1234.56", "1.234" → número. Inválido → null. */
export function valorDoTexto(s: string): number | null {
  let t = s.replace(/r\$/i, "").replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  // "1.234" sem vírgula: ponto de milhar quando sobram exatamente 3 dígitos.
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** "01/09/2026", "1/9/2026" ou "2026-09-01" → "2026-09-01". Inválido → null. */
export function dataDoTexto(s: string): string | null {
  const t = s.trim();
  let a: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (iso) [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) [d, m, a] = [Number(br[1]), Number(br[2]), Number(br[3])];
  else return null;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Lê o que a pessoa colou da planilha: uma linha por custo, colunas
 * `placa · tipo · valor por mês · vale desde (opcional)`, separadas por TAB
 * (o que o Excel e o Google Planilhas põem ao copiar) ou ponto e vírgula.
 *
 * Linha de cabeçalho é pulada sozinha (o tipo dela não é um tipo). A data
 * vazia usa `desdePadrao`.
 */
export function interpretarPlanilhaCustoFixo(
  texto: string,
  desdePadrao: string,
): { itens: (ItemLoteCustoFixo & { linha: number })[]; erros: { linha: number; mensagem: string }[] } {
  const itens: (ItemLoteCustoFixo & { linha: number })[] = [];
  const erros: { linha: number; mensagem: string }[] = [];
  const linhas = texto.split(/\r?\n/);
  linhas.forEach((bruta, i) => {
    const linha = i + 1;
    if (!bruta.trim()) return;
    const cols = bruta.split(bruta.includes("\t") ? "\t" : ";").map((c) => c.trim());
    const [placa = "", tipoTxt = "", valorTxt = "", desdeTxt = ""] = cols;
    const tipo = tipoCustoFixoDoTexto(tipoTxt);
    // Cabeçalho: primeira linha com texto onde iria o valor.
    if (linha === 1 && !tipo && valorDoTexto(valorTxt) == null) return;
    if (!placa) return void erros.push({ linha, mensagem: "Falta a placa." });
    if (!tipo) {
      return void erros.push({
        linha,
        mensagem: `Não reconheci o custo "${tipoTxt}". Use IPVA, Seguro, Parcela, Rastreador, Licenciamento, Depreciação, Salário ou Outro.`,
      });
    }
    const valorMensal = valorDoTexto(valorTxt);
    if (valorMensal == null) return void erros.push({ linha, mensagem: `Valor por mês inválido: "${valorTxt}".` });
    const vigenciaDe = desdeTxt ? dataDoTexto(desdeTxt) : desdePadrao;
    if (!vigenciaDe) return void erros.push({ linha, mensagem: `Data inválida: "${desdeTxt}". Use dd/mm/aaaa.` });
    itens.push({ linha, placa, tipo, valorMensal, vigenciaDe });
  });
  return { itens, erros };
}
