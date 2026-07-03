import type { FonteGps } from "@ronan/shared-types";
import { Badge } from "@/components/ui/badge";

/**
 * Badge da qualidade do GPS no momento da captura (viagem/local). Combina a
 * fonte (PRECISA/BALANCED/CACHE) com a precisão em metros:
 * - CACHE → "GPS do cache" (âmbar): posição veio do last-known do sistema, o
 *   motorista estava sem sinal — pode estar defasada.
 * - senão classifica pela precisão: Ótimo / Bom / Razoável / Fraco.
 * Retorna null quando não há dado nenhum (registro antigo pré-feature / PWA sem
 * fonte e sem precisão) — a tela segue mostrando o que já mostrava.
 */
export function SinalGpsBadge({
  precisao,
  fonte,
  limiteSinalFraco = 50,
}: {
  precisao?: number | null;
  fonte?: FonteGps | null;
  limiteSinalFraco?: number;
}) {
  const temPrecisao = precisao != null;
  if (!fonte && !temPrecisao) return null;

  const metros = temPrecisao ? ` ±${Math.round(precisao!)}m` : "";

  // Cache manda: independentemente da precisão, sinaliza que veio do cache.
  if (fonte === "CACHE") {
    return (
      <Badge className="border-transparent bg-amber-100 text-amber-700">
        GPS do cache{metros}
      </Badge>
    );
  }

  const { label, className } = classificar(precisao ?? null, limiteSinalFraco);
  return <Badge className={`border-transparent ${className}`}>{label}{metros}</Badge>;
}

function classificar(
  precisao: number | null,
  limite: number,
): { label: string; className: string } {
  if (precisao == null) {
    // Sem precisão mas com fonte (raro) — só confirma que houve captura.
    return { label: "GPS", className: "bg-slate-100 text-slate-600" };
  }
  if (precisao <= 15) return { label: "Ótimo", className: "bg-emerald-100 text-emerald-700" };
  if (precisao <= 30) return { label: "Bom", className: "bg-emerald-100 text-emerald-700" };
  if (precisao <= limite) return { label: "Razoável", className: "bg-amber-100 text-amber-700" };
  return { label: "Fraco", className: "bg-red-100 text-red-700" };
}
