import { Injectable } from "@nestjs/common";
import { PedagiosRodoviaService } from "./pedagios-rodovia.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RoteamentoService } from "../../roteamento/roteamento.service";

const DISTANCIA_MAX_METROS = 150; // raio em volta da polyline pra considerar "na rota"
const ENVELOPE_PADDING_GRAUS = 0.05; // ~5.5km de folga no bbox pré-filtro

export type PedagioNaRota = {
  id: string;
  nome: string;
  rodovia: string | null;
  concessionaria: string | null;
  distanciaMetros: number;
  lat: number;
  lng: number;
};

/**
 * `pedagios: null` = NÃO SEI (sem geometria confiável pra checar), que é
 * diferente de `[]` = checei e não passa por praça nenhuma. Quem exibe não
 * pode afirmar "sem pedágio" no primeiro caso.
 */
export type PedagiosDaViagem = { pedagios: PedagioNaRota[] | null };

@Injectable()
export class PedagiosRodoviaConsultaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pedagiosAdmin: PedagiosRodoviaService,
    private readonly roteamento: RoteamentoService,
  ) {}

  /**
   * Lista pedágios cadastrados que ficam na rota OSRM entre os 2 locais.
   * Usa a geometria já cacheada em `rotaCache` — não chama OSRM de novo.
   * Se a rota nunca foi calculada (motorista nunca abriu a viagem com
   * esses 2 locais), retorna lista vazia. App motorista calcula a rota
   * primeiro via `useCalcularRota` e depois consulta aqui.
   *
   * Para uma viagem que já existe use `pedagiosDaViagem`: o cache é por PAR de
   * locais e guarda sempre a variante COM retorno, então aqui a resposta ignora
   * tanto a rota que o motorista escolheu quanto o "cheguei direto".
   */
  async pedagiosNaRota(origemId: string, destinoId: string): Promise<PedagioNaRota[]> {
    if (origemId === destinoId) return [];
    const cache = await this.prisma.rotaCache.findUnique({
      where: {
        localOrigemId_localDestinoId: { localOrigemId: origemId, localDestinoId: destinoId },
      },
      select: { geometria: true },
    });
    if (!cache?.geometria) return [];
    return this.pedagiosNaGeometria(cache.geometria);
  }

  /**
   * Pedágios da rota que ESTA viagem de fato percorreu, incluindo as pernas de
   * bota-fora. Usa `opts.somenteCache` na listagem (roda por linha; não pode
   * pagar OSRM) — no detalhe, uma viagem só vale a chamada.
   */
  async pedagiosDaViagem(
    viagemId: string,
    opts: { somenteCache?: boolean } = {},
  ): Promise<PedagiosDaViagem> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        localCargaId: true,
        localDescargaId: true,
        rotaGeometria: true,
        retornoConfirmado: true,
        trechos: { select: { tipo: true, localId: true, ordem: true }, orderBy: { ordem: "asc" } },
      },
    });
    // EM_ANDAMENTO ainda não tem os dois locais: nada pra rotear.
    const { localCargaId, localDescargaId } = viagem ?? {};
    if (!viagem || !localCargaId || !localDescargaId) return { pedagios: null };

    const ida = await this.geometriaDaIda(
      {
        localCargaId,
        localDescargaId,
        rotaGeometria: viagem.rotaGeometria,
        retornoConfirmado: viagem.retornoConfirmado,
      },
      opts,
    );
    if (!ida) return { pedagios: null };

    // Perna de bota-fora: descarga→carga. Sem ela os pedágios da volta ficavam
    // de fora, mesmo com o km dela já entrando no faturável.
    const pernas: Array<[string, string]> = [];
    let anterior = localDescargaId;
    for (const t of viagem.trechos) {
      if (t.tipo !== "RETORNO_BOTA_FORA") continue;
      pernas.push([anterior, t.localId]);
      anterior = t.localId;
    }

    const geometrias = [ida];
    for (const [origem, destino] of pernas) {
      const g = await this.geometriaDaPerna(origem, destino, opts);
      // Perna sem geometria = subcontagem silenciosa; melhor dizer "não sei".
      if (!g) return { pedagios: null };
      geometrias.push(g);
    }

    const porId = new Map<string, PedagioNaRota>();
    for (const g of geometrias) {
      for (const p of await this.pedagiosNaGeometria(g)) {
        // Mesma praça na ida e na volta = 1 praça na lista (o aviso conta
        // praças distintas, não cobranças).
        const jaVisto = porId.get(p.id);
        if (!jaVisto || p.distanciaMetros < jaVisto.distanciaMetros) porId.set(p.id, p);
      }
    }
    const pedagios = [...porId.values()].sort((a, b) => a.distanciaMetros - b.distanciaMetros);
    return { pedagios };
  }

  /**
   * A geometria da ida, na ordem: o que o motorista escolheu no seletor →
   * a variante coerente com "cheguei direto" → o cache validado.
   */
  private async geometriaDaIda(
    viagem: {
      localCargaId: string;
      localDescargaId: string;
      rotaGeometria: string | null;
      retornoConfirmado: boolean | null;
    },
    opts: { somenteCache?: boolean },
  ): Promise<string | null> {
    if (viagem.rotaGeometria) return viagem.rotaGeometria;

    // O rotaCache guarda sempre a variante COM retorno (curb). Num "cheguei
    // direto" ela pode passar por praça que o motorista não cruzou, então a
    // sem-retorno é recalculada em vez de lida do cache.
    if (viagem.retornoConfirmado === false) {
      if (opts.somenteCache) return null;
      const res = await this.roteamento.calcularComSemRetorno(
        viagem.localCargaId,
        viagem.localDescargaId,
      );
      const semRetorno = res.rotas.find((r) => r.retorno === false);
      // Só a com_retorno respondeu (ou colapsaram por dedup): sem variante
      // distinta pra checar, não dá pra afirmar nada.
      return semRetorno?.geometria ?? null;
    }

    return this.roteamento.geometriaCacheada(viagem.localCargaId, viagem.localDescargaId);
  }

  private async geometriaDaPerna(
    origemId: string,
    destinoId: string,
    opts: { somenteCache?: boolean },
  ): Promise<string | null> {
    const cacheada = await this.roteamento.geometriaCacheada(origemId, destinoId);
    if (cacheada || opts.somenteCache) return cacheada;
    const res = await this.roteamento.calcularKm(origemId, destinoId);
    return res.km === null ? null : res.geometria;
  }

  /** Praças a até DISTANCIA_MAX_METROS da polyline, mais perto primeiro. */
  async pedagiosNaGeometria(geometria: string): Promise<PedagioNaRota[]> {
    const pontos = decodePolyline(geometria);
    if (pontos.length < 2) return [];

    const bbox = bboxComFolga(pontos);
    const candidatos = await this.pedagiosAdmin.listarNoEnvelope(bbox);
    if (candidatos.length === 0) return [];

    const proximos: PedagioNaRota[] = [];
    for (const p of candidatos) {
      const dist = menorDistanciaAteRota(p.lat, p.lng, pontos);
      if (dist <= DISTANCIA_MAX_METROS) {
        proximos.push({
          id: p.id,
          nome: p.nome,
          rodovia: p.rodovia,
          concessionaria: p.concessionaria,
          distanciaMetros: Math.round(dist),
          lat: p.lat,
          lng: p.lng,
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
