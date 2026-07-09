import { useEffect, useMemo, useRef, useState } from "react";
import polyline from "@mapbox/polyline";
import type { ManobraNav, RotaNav } from "@/lib/queries";

/**
 * Motor do guia de navegação ao vivo. Casa a posição do motorista com a rota do
 * Valhalla, calcula a distância até a próxima manobra e FALA (voz) na hora certa.
 * Detecta quando saiu da rota pra pedir recálculo.
 *
 * Matemática feita À MÃO (haversine + projeção no segmento) — sem @turf, que é
 * ESM e não casava com o Hermes (funções viravam undefined → crash em runtime).
 * O motor é blindado em try/catch: se algo falhar, o guia só não atualiza (nunca
 * derruba a tela). Tudo aditivo — não toca no tracking de km.
 */

export type PosAoVivo = {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
};

// Voz BLINDADA: expo-speech é módulo NATIVO. Nos apps atuais (OTA sem rebuild
// nativo) ele não existe → import dinâmico + try/catch fazem a voz falhar em
// SILÊNCIO em vez de quebrar. Com o build nativo com expo-speech, passa a falar.
let speechMod: typeof import("expo-speech") | null | undefined = undefined;
async function falar(texto: string): Promise<void> {
  try {
    if (speechMod === undefined) speechMod = await import("expo-speech");
    if (!speechMod) return;
    speechMod.stop();
    speechMod.speak(texto, { language: "pt-BR" });
  } catch {
    speechMod = null;
  }
}

export type EstadoGuia = {
  /** Próxima manobra à frente (null = chegou/sem manobra). */
  manobra: ManobraNav | null;
  /** Distância até a próxima manobra (metros). */
  distProxM: number;
  /** Distância restante total até o destino (metros). */
  restanteM: number;
  /** true = o motorista está longe da rota (candidato a recálculo). */
  foraDaRota: boolean;
};

const R = 6371000;
const TO_RAD = Math.PI / 180;

function metros(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * TO_RAD;
  const dLng = (bLng - aLng) * TO_RAD;
  const la1 = aLat * TO_RAD;
  const la2 = bLat * TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type RotaBase = { pts: [number, number][]; cumM: number[]; totalM: number };

/**
 * Projeta a posição na polilinha: devolve a distância PERCORRIDA na rota até o
 * ponto mais próximo (alongM) e a distância PERPENDICULAR à rota (offM). Usa
 * aproximação planar local (equirretangular) — precisa o bastante nessas escalas.
 */
function projetar(base: RotaBase, qLat: number, qLng: number): {
  alongM: number;
  offM: number;
} {
  const coslat = Math.cos(qLat * TO_RAD);
  const X = (lng: number) => lng * TO_RAD * R * coslat;
  const Y = (lat: number) => lat * TO_RAD * R;
  const qx = X(qLng);
  const qy = Y(qLat);
  let bestOff = Infinity;
  let bestAlong = 0;
  for (let i = 0; i < base.pts.length - 1; i++) {
    const a = base.pts[i]!;
    const b = base.pts[i + 1]!;
    const ax = X(a[1]);
    const ay = Y(a[0]);
    const bx = X(b[1]);
    const by = Y(b[0]);
    const dx = bx - ax;
    const dy = by - ay;
    const seg2 = dx * dx + dy * dy;
    let t = seg2 > 0 ? ((qx - ax) * dx + (qy - ay) * dy) / seg2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const off = Math.hypot(qx - px, qy - py);
    if (off < bestOff) {
      bestOff = off;
      bestAlong = base.cumM[i]! + t * (base.cumM[i + 1]! - base.cumM[i]!);
    }
  }
  return { alongM: bestAlong, offM: bestOff };
}

/** Stream de posição em foreground (só enquanto `ativo`). BestForNavigation. */
export function usePosicaoAoVivo(ativo: boolean): PosAoVivo | null {
  const [pos, setPos] = useState<PosAoVivo | null>(null);

  useEffect(() => {
    if (!ativo) {
      setPos(null);
      return;
    }
    let alive = true;
    let sub: { remove: () => void } | null = null;
    void (async () => {
      try {
        const Location = await import("expo-location");
        const atual = await Location.getForegroundPermissionsAsync();
        if (!atual.granted) {
          const req = await Location.requestForegroundPermissionsAsync();
          if (!req.granted) return;
        }
        const s = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 5,
          },
          (p) => {
            if (!alive) return;
            setPos({
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              heading: p.coords.heading ?? null,
              speed: p.coords.speed ?? null,
            });
          },
        );
        if (alive) sub = s;
        else s.remove();
      } catch {
        /* sem GPS: o guia fica sem posição (mapa ainda mostra a rota) */
      }
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [ativo]);

  return pos;
}

/**
 * Guia: dada a rota Valhalla e a posição ao vivo, devolve a próxima manobra +
 * distâncias e FALA os avisos (alerta ~400m, instrução ~130m). Chama
 * `onRecalcular` quando o motorista fica ~5s fora da rota.
 */
export function useGuiaNavegacao(
  rota: RotaNav | null,
  pos: PosAoVivo | null,
  onRecalcular?: () => void,
): EstadoGuia {
  // Pré-computa os pontos + distância acumulada por vértice (uma vez por rota).
  const base = useMemo<RotaBase | null>(() => {
    if (!rota) return null;
    try {
      const dec = polyline.decode(rota.shape, 6) as [number, number][]; // [lat,lng]
      if (dec.length < 2) return null;
      const cumM: number[] = [0];
      for (let i = 1; i < dec.length; i++) {
        cumM[i] =
          cumM[i - 1]! + metros(dec[i - 1]![0], dec[i - 1]![1], dec[i]![0], dec[i]![1]);
      }
      return { pts: dec, cumM, totalM: cumM[cumM.length - 1]! };
    } catch {
      return null;
    }
  }, [rota]);

  const [estado, setEstado] = useState<EstadoGuia>({
    manobra: null,
    distProxM: 0,
    restanteM: 0,
    foraDaRota: false,
  });

  const faladoRef = useRef<{ idx: number; alerta: boolean; pre: boolean }>({
    idx: -1,
    alerta: false,
    pre: false,
  });
  const foraDesdeRef = useRef<number | null>(null);
  const avisouForaRef = useRef(false);

  useEffect(() => {
    if (!base || !rota || !pos) return;
    try {
      const { alongM, offM } = projetar(base, pos.lat, pos.lng);

      const prox =
        rota.maneuvers.find(
          (m) => (base.cumM[m.beginShapeIndex] ?? 0) > alongM + 5,
        ) ?? null;
      const distProxM = prox
        ? Math.max(0, (base.cumM[prox.beginShapeIndex] ?? 0) - alongM)
        : 0;
      const restanteM = Math.max(0, base.totalM - alongM);
      const foraDaRota = offM > 45;

      setEstado({ manobra: prox, distProxM, restanteM, foraDaRota });

      // Voz: alerta antecipado (~400m) e instrução (~130m), 1x cada por manobra.
      if (prox) {
        if (faladoRef.current.idx !== prox.beginShapeIndex) {
          faladoRef.current = { idx: prox.beginShapeIndex, alerta: false, pre: false };
        }
        if (distProxM <= 130 && !faladoRef.current.pre) {
          faladoRef.current.pre = true;
          void falar(prox.verbalPre ?? prox.instrucao);
        } else if (distProxM <= 400 && !faladoRef.current.alerta) {
          faladoRef.current.alerta = true;
          void falar(prox.verbalAlerta ?? prox.verbalPre ?? prox.instrucao);
        }
      }

      // Fora da rota ~4s seguidos: AVISA por voz (local — funciona offline) e
      // TENTA recalcular (precisa de internet; offline vira no-op no callback).
      // Fala 1x; rearma só quando o motorista volta pra rota (não fica nagando).
      if (foraDaRota) {
        const agora = Date.now();
        if (foraDesdeRef.current == null) foraDesdeRef.current = agora;
        if (agora - foraDesdeRef.current > 4000 && !avisouForaRef.current) {
          avisouForaRef.current = true;
          void falar("Você saiu da rota.");
          onRecalcular?.();
        }
      } else {
        foraDesdeRef.current = null;
        avisouForaRef.current = false;
      }
    } catch {
      /* qualquer erro no motor: não atualiza o guia, mas NÃO derruba a tela */
    }
  }, [base, rota, pos, onRecalcular]);

  return estado;
}
