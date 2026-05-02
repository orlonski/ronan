import type {
  StatusFechamento,
  StatusLinhaFechamento,
} from "./fechamentos-api";

export const STATUS_FECHAMENTO_LABEL: Record<StatusFechamento, string> = {
  RECEBIDO: "Recebido",
  EM_PROCESSAMENTO: "Processando",
  AGUARDANDO_REVISAO: "Aguardando revisão",
  CONFERIDO: "Conferido",
  EXPORTADO: "Exportado",
  SUBSTITUIDO: "Substituído",
};

export const STATUS_FECHAMENTO_COLOR: Record<StatusFechamento, string> = {
  RECEBIDO: "bg-blue-100 text-blue-800 border-blue-200",
  EM_PROCESSAMENTO: "bg-purple-100 text-purple-800 border-purple-200",
  AGUARDANDO_REVISAO: "bg-amber-100 text-amber-900 border-amber-200",
  CONFERIDO: "bg-green-100 text-green-800 border-green-200",
  EXPORTADO: "bg-emerald-100 text-emerald-800 border-emerald-200",
  SUBSTITUIDO: "bg-gray-100 text-gray-600 border-gray-200",
};

export const STATUS_LINHA_LABEL: Record<StatusLinhaFechamento, string> = {
  MATCH: "OK (auto)",
  MATCH_IA: "OK (IA)",
  DIVERGENCIA: "Divergente",
  FALTANDO: "Faltando",
  EXTRA: "Extra",
  RESOLVIDA_OPERADORA: "Resolvida",
};

export const STATUS_LINHA_COLOR: Record<StatusLinhaFechamento, string> = {
  MATCH: "bg-green-100 text-green-800",
  MATCH_IA: "bg-emerald-100 text-emerald-800",
  DIVERGENCIA: "bg-red-100 text-red-800",
  FALTANDO: "bg-amber-100 text-amber-900",
  EXTRA: "bg-orange-100 text-orange-800",
  RESOLVIDA_OPERADORA: "bg-blue-100 text-blue-800",
};

export function fmtBR(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function fmtNum(value: string | number | null | undefined, casas = 2): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function fmtBRL(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function fmtDataHoraBR(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const HH = String(date.getHours()).padStart(2, "0");
  const MM = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
}
