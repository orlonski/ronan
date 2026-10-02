import type { ExtrairCupomResult } from "@ronan/shared-types";

/**
 * O que a IA leu do cupom de combustível, já conferido. A IA às vezes troca
 * litros por valor ou lê o total da bomba do dia: número fora do plausível
 * some (o motorista digita), em vez de entrar no formulário como certo.
 */
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() ? lerNumero(v) : undefined;

function lerNumero(s: string): number | undefined {
  let t = s.replace(/[^\d,.-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function lerData(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(v.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  const [a, m, d] = br
    ? [Number(br[3]!.length === 2 ? `20${br[3]}` : br[3]), Number(br[2]), Number(br[1])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [0, 0, 0];
  if (!a) return undefined;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

function lerTipo(v: unknown): ExtrairCupomResult["tipo"] {
  if (typeof v !== "string") return undefined;
  const t = v.toUpperCase();
  if (t.includes("ARLA")) return "ARLA_32";
  if (t.includes("S500") || t.includes("S-500") || t.includes("S 500")) return "DIESEL_S500";
  if (t.includes("DIESEL") || t.includes("S10") || t.includes("S-10")) return "DIESEL_S10";
  if (t.includes("ETANOL") || t.includes("ALCOOL") || t.includes("ÁLCOOL")) return "ETANOL";
  if (t.includes("GASOLINA")) return "GASOLINA";
  return undefined;
}

export function cupomDoJson(p: Record<string, unknown>): ExtrairCupomResult {
  let litros = num(p.litros);
  let valorTotal = num(p.valorTotal);
  if (litros != null && (litros <= 0 || litros > 2000)) litros = undefined;
  if (valorTotal != null && (valorTotal <= 0 || valorTotal > 50_000)) valorTotal = undefined;
  let precoLitro = litros && valorTotal ? Math.round((valorTotal / litros) * 1000) / 1000 : num(p.precoLitro);
  // Litro de R$ 0,50 ou de R$ 30 é leitura trocada: descarta o par inteiro.
  if (precoLitro != null && (precoLitro < 1 || precoLitro > 20)) {
    precoLitro = undefined;
    if (litros && valorTotal) {
      litros = undefined;
      valorTotal = undefined;
    }
  }
  const posto = typeof p.postoNome === "string" && p.postoNome.trim() ? p.postoNome.trim().slice(0, 80) : undefined;
  const conf = typeof p.confidence === "number" && Number.isFinite(p.confidence) ? Math.min(1, Math.max(0, p.confidence)) : 0;
  return {
    litros: litros != null ? Math.round(litros * 1000) / 1000 : undefined,
    valorTotal: valorTotal != null ? Math.round(valorTotal * 100) / 100 : undefined,
    precoLitro,
    postoNome: posto,
    data: lerData(p.data),
    tipo: lerTipo(p.tipo),
    confidence: conf,
  };
}

/** Instruções fixas (sem interpolação) — cada palavra é paga em toda leitura. */
export const INSTRUCOES_CUPOM = `Você lê cupons fiscais de posto de combustível no Brasil (NFC-e, cupom da bomba).
Responda SÓ com um JSON, sem texto em volta:
{"litros": número, "valorTotal": número, "precoLitro": número, "postoNome": "texto", "data": "dd/mm/aaaa", "tipo": "texto do produto", "confidence": 0 a 1}
Regras:
- litros: a quantidade abastecida (QTD, LT, L). Não confunda com o preço do litro.
- valorTotal: o valor pago deste abastecimento (VALOR TOTAL, TOTAL A PAGAR), em reais.
- postoNome: o nome fantasia ou a razão social do posto, como está no cupom.
- tipo: o produto (ex.: "DIESEL S10", "ARLA 32").
- Campo que você não conseguir ler com segurança: deixe de fora. Não chute.
- confidence: o quanto a foto estava legível (0 = nada legível, 1 = tudo claro).`;
