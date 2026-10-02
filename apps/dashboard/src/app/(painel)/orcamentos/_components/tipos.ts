import type { BasePrecoTipo, StatusOrcamentoTipo, UnidadePedidoTipo } from "@ronan/shared-types";

type Nomeado = { id: string; nome: string };
export type LocalResumo = Nomeado & { cidade: string | null; uf: string | null };

export type OrcamentoItem = {
  id: string;
  ordem: number;
  materialId: string | null;
  material: (Nomeado & { densidadeTonM3: string | null }) | null;
  tipoServicoId: string | null;
  tipoServico: Nomeado | null;
  localCargaId: string | null;
  localCarga: LocalResumo | null;
  localDescargaId: string | null;
  localDescarga: LocalResumo | null;
  descricao: string | null;
  quantidade: string;
  unidade: UnidadePedidoTipo;
  base: BasePrecoTipo;
  precoUnitario: string;
  kmEstimado: string | null;
  valor: string | null;
  semValorMotivo: string | null;
  pedido: { id: string; numero: number; status: string } | null;
  tabelaPrecoCriadaId: string | null;
};

export type Orcamento = {
  id: string;
  numero: number;
  empresaId: string | null;
  empresa: (Nomeado & { contato: string | null }) | null;
  clienteId: string | null;
  cliente: Nomeado | null;
  prospectNome: string | null;
  prospectContato: string | null;
  validadeEm: string;
  status: StatusOrcamentoTipo;
  condicoes: string | null;
  inicioPrevistoEm: string | null;
  prazoEm: string | null;
  enviadoEm: string | null;
  aprovadoEm: string | null;
  recusadoEm: string | null;
  motivoRecusa: string | null;
  vencidoEm: string | null;
  criadoEm: string;
  criadoPor: Nomeado | null;
  itens: OrcamentoItem[];
  total: string;
  itensSemValor: number;
  destinatario: string;
};

export const STATUS_COR: Record<StatusOrcamentoTipo, string> = {
  RASCUNHO: "bg-slate-100 text-slate-700",
  ENVIADO: "bg-blue-100 text-blue-700",
  APROVADO: "bg-emerald-100 text-emerald-700",
  RECUSADO: "bg-red-100 text-red-700",
  VENCIDO: "bg-amber-100 text-amber-800",
};

export function dataBR(v: string | null | undefined): string {
  if (!v) return "—";
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function brl(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : String(v);
}

export function num(v: string | number | null | undefined, casas = 3): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: casas }) : String(v);
}
