import { distanciaMetros } from "../geo";
import { distanciaPontoSegmento } from "../polyline";

/**
 * Praças NA ORDEM em que a rota passa, com o rumo (N/S) da estrada em volta de
 * cada uma. Mesma regra de "está na rota" do `pedagios-rodovia-consulta`
 * (150 m da polyline); o que muda é guardar a POSIÇÃO ao longo do traçado —
 * é ela que dá a ordem origem → destino, e a ordem contrária denuncia a volta.
 */

export const DISTANCIA_MAX_METROS_ROTA = 150;

export type PracaNaOrdem = { id: string; idx: number; distanciaMetros: number; rumo: "NORTE" | "SUL" };

/** Rumo N/S da rota medido ±25 km em volta do ponto (estrada E-O curta engana). */
function rumo(pts: Array<[number, number]>, idx: number): "NORTE" | "SUL" {
  const acha = (passo: number) => {
    let d = 0;
    let i = idx;
    while (i + passo >= 0 && i + passo < pts.length && d < 25_000) {
      d += distanciaMetros(pts[i]![0], pts[i]![1], pts[i + passo]![0], pts[i + passo]![1]);
      i += passo;
    }
    return pts[i]!;
  };
  return acha(1)[0] - acha(-1)[0] > 0 ? "NORTE" : "SUL";
}

export function pracasNaOrdemDaRota(
  pontos: Array<[number, number]>,
  candidatos: { id: string; lat: number; lng: number }[],
  distMax = DISTANCIA_MAX_METROS_ROTA,
): PracaNaOrdem[] {
  if (pontos.length < 2) return [];
  const out: PracaNaOrdem[] = [];
  for (const c of candidatos) {
    let min = Infinity;
    let idx = -1;
    for (let i = 0; i < pontos.length - 1; i++) {
      const d = distanciaPontoSegmento(c.lat, c.lng, pontos[i]!, pontos[i + 1]!);
      if (d < min) {
        min = d;
        idx = i;
      }
    }
    if (min <= distMax) out.push({ id: c.id, idx, distanciaMetros: Math.round(min), rumo: rumo(pontos, idx) });
  }
  return out.sort((a, b) => a.idx - b.idx);
}
