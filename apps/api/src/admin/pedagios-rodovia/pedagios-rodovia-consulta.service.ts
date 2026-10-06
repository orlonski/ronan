import { Injectable } from "@nestjs/common";
import { PedagiosRodoviaService } from "./pedagios-rodovia.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RoteamentoService, chavePar } from "../../roteamento/roteamento.service";
import { menorDistanciaAteRota } from "../../common/polyline";
import { pracasNaOrdemDaRota, type PracaNaOrdem } from "../../common/tag-pedagio/rota";
import { decodificarPolyline as decodePolyline } from "../../roteamento/polyline";

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
  /**
   * Tarifa do eixo simples, como está cadastrada. Null = praça conhecida, preço
   * não cadastrado — que NÃO é a mesma coisa que grátis: quem soma tem que
   * contar essa à parte, senão o total sai menor que o real.
   */
  valorBase: string | null;
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
      },
      opts,
    );
    if (!ida) return { pedagios: null };

    const geometrias = [ida];
    for (const [origem, destino] of pernasBotaFora(localDescargaId, viagem.trechos)) {
      const g = await this.geometriaDaPerna(origem, destino, opts);
      // Perna sem geometria = subcontagem silenciosa; melhor dizer "não sei".
      if (!g) return { pedagios: null };
      geometrias.push(g);
    }

    const listas: PedagioNaRota[][] = [];
    for (const g of geometrias) listas.push(await this.pedagiosNaGeometria(g));
    return { pedagios: juntarPracas(listas) };
  }

  /**
   * `pedagiosDaViagem(id, { somenteCache: true })` de uma página inteira da
   * listagem, em ~3 consultas no total em vez de ~4 por linha: as viagens de
   * uma vez, o cache de rota de todos os pares de uma vez e as praças de um
   * envelope que cobre todas as rotas. Mesma resposta, linha a linha — quem
   * não aparece no mapa é viagem que não existe.
   */
  async pedagiosDasViagens(viagemIds: string[]): Promise<Map<string, PedagiosDaViagem>> {
    const out = new Map<string, PedagiosDaViagem>();
    if (viagemIds.length === 0) return out;
    const geometriasPorViagem = await this.geometriasDasViagens(viagemIds);

    const pontosPorGeometria = new Map<string, Array<[number, number]>>();
    for (const gs of geometriasPorViagem.values()) {
      for (const g of gs ?? []) {
        if (!pontosPorGeometria.has(g)) pontosPorGeometria.set(g, decodePolyline(g));
      }
    }
    const comRota = [...pontosPorGeometria.values()].filter((p) => p.length >= 2);
    const candidatos =
      comRota.length > 0 ? await this.pedagiosAdmin.listarNoEnvelope(bboxComFolga(comRota.flat())) : [];

    for (const [id, gs] of geometriasPorViagem) {
      if (!gs) {
        out.set(id, { pedagios: null });
        continue;
      }
      const listas = gs.map((g) => {
        const pontos = pontosPorGeometria.get(g)!;
        if (pontos.length < 2) return [];
        const bbox = bboxComFolga(pontos);
        return pracasPertoDaRota(
          pontos,
          candidatos.filter(
            (c) => c.lat >= bbox.minLat && c.lat <= bbox.maxLat && c.lng >= bbox.minLng && c.lng <= bbox.maxLng,
          ),
        );
      });
      out.set(id, { pedagios: juntarPracas(listas) });
    }
    return out;
  }

  /**
   * As geometrias que cada viagem percorreu (ida + pernas de bota-fora), só do
   * cache. null = "não sei" — mesma régua de `pedagiosDaViagem`.
   */
  private async geometriasDasViagens(viagemIds: string[]): Promise<Map<string, string[] | null>> {
    const viagens = await this.prisma.viagem.findMany({
      where: { id: { in: viagemIds } },
      select: {
        id: true,
        localCargaId: true,
        localDescargaId: true,
        rotaGeometria: true,
        trechos: { select: { tipo: true, localId: true, ordem: true }, orderBy: { ordem: "asc" } },
      },
    });

    const pares: Array<[string, string]> = [];
    for (const v of viagens) {
      if (!v.localCargaId || !v.localDescargaId) continue;
      if (!v.rotaGeometria) pares.push([v.localCargaId, v.localDescargaId]);
      pares.push(...pernasBotaFora(v.localDescargaId, v.trechos));
    }
    const cache = await this.roteamento.geometriasCacheadas(pares);

    // Geometrias de cada viagem; null = "não sei", igual a pedagiosDaViagem.
    const geometriasPorViagem = new Map<string, string[] | null>();
    for (const v of viagens) {
      const { localCargaId, localDescargaId } = v;
      if (!localCargaId || !localDescargaId) {
        geometriasPorViagem.set(v.id, null);
        continue;
      }
      const ida = v.rotaGeometria ?? cache.get(chavePar(localCargaId, localDescargaId)) ?? null;
      const pernas = pernasBotaFora(localDescargaId, v.trechos).map(
        ([o, d]) => cache.get(chavePar(o, d)) ?? null,
      );
      const todas = ida ? [ida, ...pernas] : [];
      geometriasPorViagem.set(v.id, ida && todas.every(Boolean) ? (todas as string[]) : null);
    }

    return geometriasPorViagem;
  }

  /**
   * Praças da rota de cada viagem NA ORDEM do traçado, com o rumo (N/S) da
   * estrada em cada uma — o que a conferência da tag usa pra dizer se as
   * passagens foram na ordem origem → destino (e denunciar a volta). Mesma
   * regra de "está na rota" (150 m) e mesma geometria de `pedagiosDasViagens`.
   */
  async pracasEmOrdemDasViagens(
    viagemIds: string[],
  ): Promise<Map<string, Array<PracaNaOrdem & { lat: number; lng: number; nome: string }> | null>> {
    const out = new Map<string, Array<PracaNaOrdem & { lat: number; lng: number; nome: string }> | null>();
    if (viagemIds.length === 0) return out;
    const geometrias = await this.geometriasDasViagens(viagemIds);
    const pontosDe = new Map<string, Array<[number, number]>>();
    for (const gs of geometrias.values()) for (const g of gs ?? []) if (!pontosDe.has(g)) pontosDe.set(g, decodePolyline(g));
    const comRota = [...pontosDe.values()].filter((p) => p.length >= 2);
    const candidatos = comRota.length ? await this.pedagiosAdmin.listarNoEnvelope(bboxComFolga(comRota.flat())) : [];
    const porId = new Map(candidatos.map((c) => [c.id, c]));
    for (const id of viagemIds) {
      const gs = geometrias.get(id);
      if (!gs) {
        out.set(id, null);
        continue;
      }
      const lista: Array<PracaNaOrdem & { lat: number; lng: number; nome: string }> = [];
      let base = 0;
      for (const g of gs) {
        const pontos = pontosDe.get(g)!;
        for (const p of pracasNaOrdemDaRota(pontos, candidatos)) {
          const c = porId.get(p.id)!;
          lista.push({ ...p, idx: base + p.idx, lat: c.lat, lng: c.lng, nome: c.nome });
        }
        base += pontos.length;
      }
      out.set(id, lista);
    }
    return out;
  }

  /**
   * A geometria da ida: o que o motorista escolheu no seletor de rota →
   * senão o cache validado (rota direta, coerente com o roteador atual).
   */
  private async geometriaDaIda(
    viagem: {
      localCargaId: string;
      localDescargaId: string;
      rotaGeometria: string | null;
    },
    _opts: { somenteCache?: boolean },
  ): Promise<string | null> {
    if (viagem.rotaGeometria) return viagem.rotaGeometria;
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
    return pracasPertoDaRota(pontos, candidatos);
  }
}

type PracaCandidata = Awaited<ReturnType<PedagiosRodoviaService["listarNoEnvelope"]>>[number];

/** Das candidatas, as praças a até DISTANCIA_MAX_METROS da polyline, mais perto primeiro. */
function pracasPertoDaRota(
  pontos: Array<[number, number]>,
  candidatos: PracaCandidata[],
): PedagioNaRota[] {
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
        valorBase: p.valorBase == null ? null : p.valorBase.toFixed(2),
      });
    }
  }
  proximos.sort((a, b) => a.distanciaMetros - b.distanciaMetros);
  return proximos;
}

/**
 * Pernas de bota-fora: descarga→carga. Sem elas os pedágios da volta ficavam
 * de fora, mesmo com o km delas já entrando no faturável.
 */
function pernasBotaFora(
  localDescargaId: string,
  trechos: Array<{ tipo: string; localId: string }>,
): Array<[string, string]> {
  const pernas: Array<[string, string]> = [];
  let anterior = localDescargaId;
  for (const t of trechos) {
    if (t.tipo !== "RETORNO_BOTA_FORA") continue;
    pernas.push([anterior, t.localId]);
    anterior = t.localId;
  }
  return pernas;
}

/**
 * Mesma praça na ida e na volta = 1 praça na lista (o aviso conta praças
 * distintas, não cobranças).
 */
function juntarPracas(listas: PedagioNaRota[][]): PedagioNaRota[] {
  const porId = new Map<string, PedagioNaRota>();
  for (const lista of listas) {
    for (const p of lista) {
      const jaVisto = porId.get(p.id);
      if (!jaVisto || p.distanciaMetros < jaVisto.distanciaMetros) porId.set(p.id, p);
    }
  }
  return [...porId.values()].sort((a, b) => a.distanciaMetros - b.distanciaMetros);
}

// ===== Helpers geométricos =====

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


