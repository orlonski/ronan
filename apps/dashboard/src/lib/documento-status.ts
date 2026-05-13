import type { TipoDocumentoMotorista } from "@ronan/shared-types";

export type DocumentoStatus = "FALTANDO" | "OK" | "A_VENCER" | "VENCIDO";

const DIA_MS = 24 * 60 * 60 * 1000;
const LIMIAR_VENCER_DIAS = 30;

type DocLike = { validade: string | null } | undefined | null;

/**
 * Normaliza pra "YYYY-MM-DD". A API tem dois pontos de entrada de validade:
 * GET /admin/motoristas/:id/documentos passa por publicShape e devolve só a
 * data; GET /admin/motoristas vem direto do Prisma e serializa Date como ISO
 * completo (tipo "2031-10-22T00:00:00.000Z"). Aqui aceitamos os dois.
 */
function partesData(validade: string | null): { y: number; m: number; d: number } | null {
  if (!validade) return null;
  const raw = validade.slice(0, 10);
  const [yStr, mStr, dStr] = raw.split("-");
  if (!yStr || !mStr || !dStr) return null;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return { y, m, d };
}

/**
 * "YYYY-MM-DD" (ou ISO completo) → "DD/MM/YYYY". Devolve a entrada se não der
 * pra parsear.
 */
export function formatValidadeBR(validade: string | null | undefined): string {
  if (!validade) return "";
  const p = partesData(validade);
  if (!p) return validade;
  const dd = String(p.d).padStart(2, "0");
  const mm = String(p.m).padStart(2, "0");
  const yyyy = String(p.y).padStart(4, "0");
  return `${dd}/${mm}/${yyyy}`;
}

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
  const p = partesData(doc.validade);
  if (!p) return "OK";
  const venc = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const inicioHoje = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  const dias = Math.round((venc.getTime() - inicioHoje.getTime()) / DIA_MS);
  if (dias < 0) return "VENCIDO";
  if (dias <= LIMIAR_VENCER_DIAS) return "A_VENCER";
  return "OK";
}

export function diasParaVencer(validade: string | null, hoje: Date = new Date()): number | null {
  const p = partesData(validade);
  if (!p) return null;
  const venc = new Date(Date.UTC(p.y, p.m - 1, p.d));
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
