import { Injectable } from "@nestjs/common";
import { PedagiosRodoviaService } from "../admin/pedagios-rodovia/pedagios-rodovia.service";
import { PrismaService } from "../prisma/prisma.service";

const DISTANCIA_MAX_METROS = 80; // raio em volta da polyline pra considerar "na rota"
const ENVELOPE_PADDING_GRAUS = 0.05; // ~5.5km de folga no bbox pré-filtro

@Injectable()
export class PedagiosRodoviaConsultaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pedagiosAdmin: PedagiosRodoviaService,
  ) {}

  /**
   * Lista pedágios cadastrados que ficam na rota OSRM entre os 2 locais.
   * Usa a geometria já cacheada em `rotaCache` — não chama OSRM de novo.
   * Se a rota nunca foi calculada (motorista nunca abriu a viagem com
   * esses 2 locais), retorna lista vazia. App motorista calcula a rota
   * primeiro via `useCalcularRota` e depois consulta aqui.
   */
  async pedagiosNaRota(
    origemId: string,
    destinoId: string,
  ): Promise<
    Array<{
      id: string;
      nome: string;
      rodovia: string | null;
      concessionaria: string | null;
      distanciaMetros: number;
    }>
  > {
    if (origemId === destinoId) return [];
    const cache = await this.prisma.rotaCache.findUnique({
      where: {
        localOrigemId_localDestinoId: { localOrigemId: origemId, localDestinoId: destinoId },
      },
      select: { geometria: true },
    });
    if (!cache?.geometria) return [];

    const pontos = decodePolyline(cache.geometria);
    if (pontos.length < 2) return [];

    const bbox = bboxComFolga(pontos);
    const candidatos = await this.pedagiosAdmin.listarNoEnvelope(bbox);
    if (candidatos.length === 0) return [];

    const proximos: Array<{
      id: string;
      nome: string;
      rodovia: string | null;
      concessionaria: string | null;
      distanciaMetros: number;
    }> = [];
    for (const p of candidatos) {
      const dist = menorDistanciaAteRota(p.lat, p.lng, pontos);
      if (dist <= DISTANCIA_MAX_METROS) {
        proximos.push({
          id: p.id,
          nome: p.nome,
          rodovia: p.rodovia,
          concessionaria: p.concessionaria,
          distanciaMetros: Math.round(dist),
        });
      }
    }
    proximos.sort((a, b) => a.distanciaMetros - b.distanciaMetros);
    return proximos;
  }
}

// ===== Helpers geométricos =====

/**
 * Decode polyline encoded (Google polyline algorithm, precision 5).
 * OSRM retorna nesse formato com `overview=simplified&geometries=polyline`.
 */
function decodePolyline(encoded: string): Array<[number, number]> {
  const pontos: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pontos.push([lat / 1e5, lng / 1e5]);
  }
  return pontos;
}

function bboxComFolga(pontos: Array<[number, number]>): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  let minLat = pontos[0]![0];
  let maxLat = pontos[0]![0];
  let minLng = pontos[0]![1];
  let maxLng = pontos[0]![1];
  for (const [lat, lng] of pontos) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return {
    minLat: minLat - ENVELOPE_PADDING_GRAUS,
    maxLat: maxLat + ENVELOPE_PADDING_GRAUS,
    minLng: minLng - ENVELOPE_PADDING_GRAUS,
    maxLng: maxLng + ENVELOPE_PADDING_GRAUS,
  };
}

const R_TERRA_M = 6_371_000;
const toRad = (g: number): number => (g * Math.PI) / 180;

function haversineMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRA_M * Math.asin(Math.sqrt(a));
}

function menorDistanciaAteRota(
  lat: number,
  lng: number,
  pontos: Array<[number, number]>,
): number {
  let min = Infinity;
  for (let i = 0; i < pontos.length - 1; i++) {
    const d = distanciaPontoSegmento(lat, lng, pontos[i]!, pontos[i + 1]!);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Distância mínima do ponto até o segmento. Projeção planar local (cartesiana
 * em lat/lng) pra achar o ponto mais próximo no segmento; depois haversine
 * pra distância real. Suficiente pra distâncias curtas (segmentos OSRM têm
 * ~poucas centenas de metros).
 */
function distanciaPontoSegmento(
  lat: number,
  lng: number,
  a: [number, number],
  b: [number, number],
): number {
  const ax = a[1];
  const ay = a[0];
  const bx = b[1];
  const by = b[0];
  const px = lng;
  const py = lat;

  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return haversineMetros(lat, lng, a[0], a[1]);
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  const projX = ax + tc * dx;
  const projY = ay + tc * dy;
  return haversineMetros(lat, lng, projY, projX);
}
