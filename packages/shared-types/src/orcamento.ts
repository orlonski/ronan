import { z } from "zod";
import { UnidadePedidoSchema } from "./pedido";
import { BasePrecoSchema } from "./tabela-preco";

/**
 * Orçamento: a proposta comercial que, aprovada, vira pedido.
 *
 * O cliente pode ainda não estar cadastrado (prospect: nome + contato livres).
 * Na aprovação, quem aprova escolhe um cliente cadastrado ou cadastra o
 * prospect como cliente na hora — pedido sempre tem quem pague.
 */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

export const STATUS_ORCAMENTO = ["RASCUNHO", "ENVIADO", "APROVADO", "RECUSADO", "VENCIDO"] as const;
export const StatusOrcamentoSchema = z.enum(STATUS_ORCAMENTO);
export type StatusOrcamentoTipo = z.infer<typeof StatusOrcamentoSchema>;

export const STATUS_ORCAMENTO_LABEL: Record<StatusOrcamentoTipo, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  VENCIDO: "Vencido",
};

/** Validade padrão de uma proposta nova, em dias. É só o valor inicial do campo. */
export const VALIDADE_PADRAO_ORCAMENTO_DIAS = 15;

export const OrcamentoItemInput = z
  .object({
    materialId: z.string().uuid().nullish(),
    tipoServicoId: z.string().uuid().nullish(),
    localCargaId: z.string().uuid().nullish(),
    localDescargaId: z.string().uuid().nullish(),
    descricao: z.string().trim().max(300).nullish(),
    quantidade: z.number().positive("Informe a quantidade.").max(999999.999),
    unidade: UnidadePedidoSchema,
    base: BasePrecoSchema,
    precoUnitario: z.number().positive("Informe o preço.").max(99999999.99),
    kmEstimado: z.number().min(0).max(99999999.99).nullish(),
  })
  // Mesma regra do pedido: m³ só existe com a densidade de um material. O item
  // vira pedido ao aprovar, e um pedido em m³ sem material é recusado lá.
  .refine((d) => d.unidade !== "M3" || !!d.materialId, {
    message: "Item em m³ precisa do material: é a densidade dele que converte o peso em volume.",
    path: ["materialId"],
  });
export type OrcamentoItemInput = z.infer<typeof OrcamentoItemInput>;

const camposOrcamento = {
  empresaId: z.string().uuid().nullish(),
  clienteId: z.string().uuid().nullish(),
  prospectNome: z.string().trim().max(200).nullish(),
  prospectContato: z.string().trim().max(200).nullish(),
  validadeEm: DATA,
  condicoes: z.string().trim().max(3000).nullish(),
  inicioPrevistoEm: DATA.nullish(),
  prazoEm: DATA.nullish(),
  itens: z.array(OrcamentoItemInput).min(1, "Coloque pelo menos um item.").max(30),
};

const temCliente = (d: { empresaId?: string | null; prospectNome?: string | null }) =>
  !!d.empresaId || !!d.prospectNome?.trim();
const prazoDepoisDoInicio = (d: { inicioPrevistoEm?: string | null; prazoEm?: string | null }) =>
  !d.prazoEm || !d.inicioPrevistoEm || d.prazoEm >= d.inicioPrevistoEm;

export const CriarOrcamentoInput = z
  .object(camposOrcamento)
  .refine(temCliente, {
    message: "Escolha um cliente cadastrado ou escreva o nome de quem vai receber a proposta.",
    path: ["prospectNome"],
  })
  .refine(prazoDepoisDoInicio, { message: "O prazo não pode ser antes do início.", path: ["prazoEm"] });
export type CriarOrcamentoInput = z.infer<typeof CriarOrcamentoInput>;

/** Edição troca a proposta inteira (itens incluídos): é um documento, não um cadastro. */
export const AtualizarOrcamentoInput = CriarOrcamentoInput;
export type AtualizarOrcamentoInput = z.infer<typeof AtualizarOrcamentoInput>;

export const AprovarOrcamentoInput = z.object({
  /** Prospect aprovado: o cliente cadastrado que vai pagar. */
  empresaId: z.string().uuid().nullish(),
  /** Prospect aprovado: cadastra-o como cliente agora (nome + contato do orçamento). */
  cadastrarCliente: z.boolean().default(false),
  /**
   * "Usar este preço na tabela do cliente a partir de hoje". Desmarcado por
   * padrão: mexer na tabela muda a fatura de viagens que ainda vão rodar, e
   * isso só acontece porque alguém decidiu.
   */
  usarPrecoNaTabela: z.boolean().default(false),
});
export type AprovarOrcamentoInput = z.infer<typeof AprovarOrcamentoInput>;

export const RecusarOrcamentoInput = z.object({
  motivo: z.string().trim().min(3, "Diga por que o cliente recusou.").max(500),
});
export type RecusarOrcamentoInput = z.infer<typeof RecusarOrcamentoInput>;

export const SugestaoItemOrcamentoQuery = z.object({
  empresaId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  tipoServicoId: z.string().uuid().optional(),
  localCargaId: z.string().uuid().optional(),
  localDescargaId: z.string().uuid().optional(),
});
export type SugestaoItemOrcamentoQuery = z.infer<typeof SugestaoItemOrcamentoQuery>;

export type SugestaoItemOrcamento = {
  /** Km da rota pelo roteador; null quando não deu (sem local, sem coordenada, sem OSRM). */
  kmEstimado: string | null;
  /** Por que não há km — pra tela explicar sem parecer erro. */
  kmMotivo: string | null;
  /** Preço da tabela vigente do cliente; null = deixar o campo em branco. */
  preco: { precoUnitario: string; base: "TONELADA" | "KM" | "VIAGEM" | "M3"; tabelaPrecoId: string } | null;
  precoMotivo: string | null;
};
