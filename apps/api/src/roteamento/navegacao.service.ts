import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const HTTP_TIMEOUT_MS = 6000;

/** Uma manobra da navegação (já normalizada do Valhalla, em pt-BR). */
export type ManobraNav = {
  /** Texto visual: "Vire à direita na Rua X". */
  instrucao: string;
  /** Frase pra FALAR pouco antes da manobra. Null se o Valhalla não mandou. */
  verbalPre: string | null;
  /** Frase de alerta antecipado ("Prepare-se pra virar à direita"). */
  verbalAlerta: string | null;
  /** Tipo da manobra (enum Valhalla; 1=start, 4=destino, etc.). */
  tipo: number;
  /** Distância desta manobra (km). */
  distanciaKm: number;
  /** Índices na shape (polyline) onde a manobra começa/termina — pra casar com a
   *  posição ao vivo no app (turf). */
  beginShapeIndex: number;
  endShapeIndex: number;
};

export type RotaNav = {
  /** Polyline encoded, precisão 6 (Valhalla). Decodificar com precision 6 no app. */
  shape: string;
  maneuvers: ManobraNav[];
  distanciaKm: number;
  tempoSeg: number;
};

export type NavResult = RotaNav | { erro: string };

type ValhallaManeuver = {
  instruction?: string;
  verbal_pre_transition_instruction?: string;
  verbal_transition_alert_instruction?: string;
  type?: number;
  length?: number;
  begin_shape_index?: number;
  end_shape_index?: number;
};
type ValhallaResponse = {
  trip?: {
    status?: number;
    summary?: { length?: number; time?: number };
    legs?: { shape?: string; maneuvers?: ValhallaManeuver[] }[];
  };
};

/**
 * Navegação turn-by-turn via Valhalla (self-hosted). ADITIVO ao OSRM: o km de
 * faturamento continua no RoteamentoService/OSRM; este serviço só monta o guia
 * ao vivo (rota + manobras faladas em pt-BR, perfil caminhão) pro app.
 *
 * A origem é a posição AO VIVO do motorista (lat/lng), não um Local fixo — por
 * isso recebe coords, não IDs. O destino é resolvido de um Local (descarga).
 */
@Injectable()
export class NavegacaoService {
  private readonly logger = new Logger(NavegacaoService.name);
  private readonly valhallaUrl = process.env.VALHALLA_URL ?? "";

  constructor(private readonly prisma: PrismaService) {}

  /** Navega da posição ao vivo até o Local de destino (descarga). */
  async navegarParaLocal(
    origemLat: number,
    origemLng: number,
    destinoLocalId: string,
  ): Promise<NavResult> {
    const destino = await this.prisma.local.findUnique({
      where: { id: destinoLocalId },
      select: { lat: true, lng: true },
    });
    if (!destino?.lat || !destino?.lng) {
      return { erro: "Local de destino sem coordenadas." };
    }
    return this.navegar(origemLat, origemLng, destino.lat, destino.lng);
  }

  /** Rota + manobras Valhalla entre dois pontos (origem ao vivo → destino). */
  async navegar(
    origemLat: number,
    origemLng: number,
    destinoLat: number,
    destinoLng: number,
  ): Promise<NavResult> {
    if (!this.valhallaUrl) {
      return { erro: "Servidor de navegação não configurado." };
    }

    const body = {
      locations: [
        { lat: origemLat, lon: origemLng },
        { lat: destinoLat, lon: destinoLng },
      ],
      costing: "truck",
      directions_options: { language: "pt-BR", units: "kilometers" },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.valhallaUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
      const data = (await res.json()) as ValhallaResponse;
      const leg = data.trip?.legs?.[0];
      if (!leg?.shape || !leg.maneuvers) {
        throw new Error("Valhalla sem rota");
      }
      const maneuvers: ManobraNav[] = leg.maneuvers.map((m) => ({
        instrucao: m.instruction ?? "",
        verbalPre: m.verbal_pre_transition_instruction ?? null,
        verbalAlerta: m.verbal_transition_alert_instruction ?? null,
        tipo: m.type ?? 0,
        distanciaKm: m.length ?? 0,
        beginShapeIndex: m.begin_shape_index ?? 0,
        endShapeIndex: m.end_shape_index ?? 0,
      }));
      return {
        shape: leg.shape,
        maneuvers,
        distanciaKm: data.trip?.summary?.length ?? 0,
        tempoSeg: Math.round(data.trip?.summary?.time ?? 0),
      };
    } catch (err) {
      this.logger.warn(`Valhalla falhou: ${(err as Error).message}`);
      return { erro: "Não foi possível montar a navegação agora." };
    } finally {
      clearTimeout(timeout);
    }
  }
}
