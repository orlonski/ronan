/** Tipos e utilitários compartilhados pelas telas de Manutenção. */

import type { StatusManutencaoTipo, StatusMultaTipo, TipoManutencaoTipo } from "@ronan/shared-types";

export type Veiculo = { id: string; placa: string };

export type Alertas = {
  manutencoes: {
    planoId: string;
    descricao: string;
    situacao: "VENCIDO" | "PROXIMO";
    kmRestante: number | null;
    diasRestante: number | null;
    motivo: "KM" | "TEMPO" | null;
    veiculo: Veiculo;
  }[];
  documentos: {
    id: string;
    tipo: string;
    veiculo: Veiculo;
    validade: string | null;
    diasRestantes: number | null;
  }[];
  pneus: {
    id: string;
    numeroFogo: string;
    posicao: string | null;
    sulcoMm: number | null;
    veiculo: Veiculo | null;
    situacao: "CRITICO" | "ATENCAO";
  }[];
  multas: {
    id: string;
    infracao: string;
    veiculo: Veiculo | null;
    motorista: { id: string; nome: string } | null;
    valor: string;
    status: StatusMultaTipo;
    diasParaIndicar: number | null;
  }[];
  emOficina: { id: string; veiculo: Veiculo; descricao: string; desde: string | null; oficina?: string | null }[];
  /** Consertos abertos que ainda não entraram na oficina. */
  agendadas?: { id: string; veiculo: Veiculo; descricao: string; previstaEm: string | null; oficina: string | null }[];
  /** Gasto de manutenção concluída no mês. */
  gastoMes?: number;
  /** Avisos do motorista esperando decisão (API antiga não manda). */
  avisosMotorista?: {
    id: string;
    descricao: string;
    avisadoEm: string;
    fotos: number;
    podeRodar: "SIM" | "COM_CUIDADO" | "NAO" | null;
    veiculo: Veiculo | null;
    motorista: { id: string; nome: string };
  }[];
};

export type Manutencao = {
  id: string;
  tipo: TipoManutencaoTipo;
  status: StatusManutencaoTipo;
  descricao: string;
  odometro: number | null;
  previstaEm: string | null;
  valorTotal: string | null;
  valorPecas?: string | null;
  anexos?: string[];
  planoId?: string | null;
  valorMaoObra?: string | null;
  veiculo: Veiculo;
  fornecedor: { id: string; nome: string } | null;
};

export function brl(v: string | number | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : String(v);
}

export function dataBR(v: string | null): string {
  if (!v) return "—";
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}


/** "20.000" → 20000; vazio → null. */
export function inteiro(v: string): number | null {
  const d = v.replace(/\D/g, "");
  return d ? Number(d) : null;
}

/** "1.234,56" → 1234.56; vazio → null. */
export function decimal(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export type Plano = {
  id: string;
  descricao: string;
  intervaloKm: number | null;
  intervaloDias: number | null;
  ultimoOdometro: number | null;
  ultimaEm: string | null;
  veiculo: Veiculo;
};

