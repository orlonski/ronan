import type { TipoDocumentoMotorista } from "@ronan/shared-types";

export type DocumentoStatus = "FALTANDO" | "OK" | "A_VENCER" | "VENCIDO";

const DIA_MS = 24 * 60 * 60 * 1000;
const LIMIAR_VENCER_DIAS = 30;

type DocLike = { validade: string | null } | undefined | null;

/**
 * Status derivado:
 * - sem doc → FALTANDO
 * - doc sem validade → OK
 * - validade < hoje → VENCIDO
 * - validade <= 30 dias → A_VENCER
 * - resto → OK
 */
export function statusDocumento(doc: DocLike, hoje: Date = new Date()): DocumentoStatus {
  if (!doc) return "FALTANDO";
  if (!doc.validade) return "OK";
  const venc = new Date(`${doc.validade}T00:00:00.000Z`);
  if (Number.isNaN(venc.getTime())) return "OK";
  const inicioHoje = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  const dias = Math.round((venc.getTime() - inicioHoje.getTime()) / DIA_MS);
  if (dias < 0) return "VENCIDO";
  if (dias <= LIMIAR_VENCER_DIAS) return "A_VENCER";
  return "OK";
}

export function diasParaVencer(validade: string | null, hoje: Date = new Date()): number | null {
  if (!validade) return null;
  const venc = new Date(`${validade}T00:00:00.000Z`);
  if (Number.isNaN(venc.getTime())) return null;
  const inicioHoje = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  return Math.round((venc.getTime() - inicioHoje.getTime()) / DIA_MS);
}

/**
 * Status agregado da lista (pior caso): se algum vencido ou faltando → VENCIDO,
 * senão se algum a vencer → A_VENCER, senão OK.
 */
export function statusAgregado(
  documentos: Array<{ tipo: TipoDocumentoMotorista; validade: string | null }>,
  tiposObrigatorios: readonly TipoDocumentoMotorista[],
  hoje: Date = new Date(),
): DocumentoStatus {
  const porTipo = new Map(documentos.map((d) => [d.tipo, d]));
  let temAVencer = false;
  for (const tipo of tiposObrigatorios) {
    const s = statusDocumento(porTipo.get(tipo), hoje);
    if (s === "FALTANDO" || s === "VENCIDO") return "VENCIDO";
    if (s === "A_VENCER") temAVencer = true;
  }
  return temAVencer ? "A_VENCER" : "OK";
}
