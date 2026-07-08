import { useEffect, useMemo, useRef, useState } from "react";
import * as Speech from "expo-speech";
import polyline from "@mapbox/polyline";
import { lineString, point } from "@turf/helpers";
import distance from "@turf/distance";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import type { ManobraNav, RotaNav } from "@/lib/queries";

/**
 * Motor do guia de navegação ao vivo. Casa a posição do motorista com a rota do
 * Valhalla (turf), calcula a distância até a próxima manobra e FALA (expo-speech,
 * pt-BR) na hora certa. Detecta quando saiu da rota pra pedir recálculo.
 *
 * Tudo é gated no app (só roda quando o guia está na tela). É aditivo — não toca
 * no tracking de km nem em nenhum fluxo existente.
 */

export type PosAoVivo = {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
};

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
      // Lazy import (padrão do lib/geo pra não quebrar o boot do expo-router).
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
 * distâncias e FALA os avisos (alerta a ~400m, instrução a ~130m). Chama
 * `onRecalcular` quando o motorista fica ~5s fora da rota.
 */
export function useGuiaNavegacao(
  rota: RotaNav | null,
  pos: PosAoVivo | null,
  onRecalcular?: () => void,
): EstadoGuia {
  // Pré-computa a linha + distância acumulada por vértice (uma vez por rota).
  const base = useMemo(() => {
    if (!rota) return null;
    try {
      const coords = polyline.decode(rota.shape, 6); // [[lat,lng], ...]
      const pts = coords.map(([lat, lng]) => [lng, lat] as [number, number]);
      if (pts.length < 2) return null;
      const line = lineString(pts);
      const cum: number[] = [0];
      for (let i = 1; i < pts.length; i++) {
        cum[i] =
          cum[i - 1]! +
          distance(point(pts[i - 1]!), point(pts[i]!), { units: "kilometers" });
      }
      return { line, cum, total: cum[cum.length - 1]! };
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

  // Debounce da voz por manobra + tempo fora da rota.
  const faladoRef = useRef<{ idx: number; alerta: boolean; pre: boolean }>({
    idx: -1,
    alerta: false,
    pre: false,
  });
  const foraDesdeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!base || !rota || !pos) return;

    const snapped = nearestPointOnLine(base.line, point([pos.lng, pos.lat]), {
      units: "kilometers",
    });
    const alongKm = (snapped.properties.location as number | undefined) ?? 0;
    const offM = ((snapped.properties.dist as number | undefined) ?? 0) * 1000;

    // Próxima manobra: a primeira cujo início está à frente da posição atual.
    const prox =
      rota.maneuvers.find(
        (m) => (base.cum[m.beginShapeIndex] ?? 0) > alongKm + 0.005,
      ) ?? null;
    const distProxM = prox
      ? Math.max(0, ((base.cum[prox.beginShapeIndex] ?? 0) - alongKm) * 1000)
      : 0;
    const restanteM = Math.max(0, (base.total - alongKm) * 1000);
    const foraDaRota = offM > 45;

    setEstado({ manobra: prox, distProxM, restanteM, foraDaRota });

    // Voz: alerta antecipado (~400m) e instrução (~130m), uma vez cada por manobra.
    if (prox) {
      const idx = prox.beginShapeIndex;
      if (faladoRef.current.idx !== idx) {
        faladoRef.current = { idx, alerta: false, pre: false };
      }
      if (distProxM <= 130 && !faladoRef.current.pre) {
        faladoRef.current.pre = true;
        Speech.stop();
        Speech.speak(prox.verbalPre ?? prox.instrucao, { language: "pt-BR" });
      } else if (distProxM <= 400 && !faladoRef.current.alerta) {
        faladoRef.current.alerta = true;
        Speech.stop();
        Speech.speak(prox.verbalAlerta ?? prox.verbalPre ?? prox.instrucao, {
          language: "pt-BR",
        });
      }
    }

    // Fora da rota por ~5s seguidos → pede recálculo (uma vez; reseta depois).
    if (foraDaRota) {
      const agora = Date.now();
      if (foraDesdeRef.current == null) {
        foraDesdeRef.current = agora;
      } else if (agora - foraDesdeRef.current > 5000 && onRecalcular) {
        foraDesdeRef.current = null;
        Speech.stop();
        Speech.speak("Recalculando a rota.", { language: "pt-BR" });
        onRecalcular();
      }
    } else {
      foraDesdeRef.current = null;
    }
  }, [base, rota, pos, onRecalcular]);

  return estado;
}
