import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AcaoAuditoria,
  FonteEvidencia,
  NivelConfiancaLocal,
  OrigemCadastroLocal,
  type Prisma,
  TipoLocal,
} from "@prisma/client";
import type { CriarLocalInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListLocaisParams = PaginationQuery & {
  clienteId?: string;
  tipo?: TipoLocal;
  ativo?: "true" | "false";
  nivelConfianca?: NivelConfiancaLocal;
  /**
   * Atalho usado pela aba "Em validação": filtra nivelConfianca <= DWELL.
   */
  emValidacao?: "true" | "false";
};

const SEARCH_FIELDS = ["nome", "logradouro", "bairro", "cidade", "pontoReferencia"] as const;

const METROS_POR_GRAU_LAT = 111_320; // ~constante; longitude encolhe com cos(lat)

/** Raio (m) pra tarja "provável duplicata" na LISTA (fixo; o mapa tem raio ajustável). */
const RAIO_DUPLICATA_M = 150;

/** Distância em metros entre dois pontos (haversine). */
function haversineMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (g: number) => (g * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Extrai um "marco" (estaca N ou KM N) do nome. Serve pra distinguir pontos de
 * rodovia/obra que são geograficamente próximos mas DIFERENTES de propósito
 * (ex.: "PR 151 - Estaca 1742" vs "…Estaca 1743" a ~50m; "BR 277 KM 168" vs "…169").
 */
function extrairMarco(nome: string): { tipo: "km" | "estaca"; n: number } | null {
  const s = nome.toLowerCase();
  const est = s.match(/\bestaca\s*0*(\d{2,4})\b/);
  if (est) return { tipo: "estaca", n: Number(est[1]) };
  const km = s.match(/\bkm\s*0*(\d{1,3})\b/);
  if (km) return { tipo: "km", n: Number(km[1]) };
  return null;
}

/**
 * Dois nomes têm marco CONFLITANTE (estaca/km diferentes) → não são duplicata,
 * mesmo perto. Se algum não tem marco, não conflita (a proximidade decide).
 */
function marcoConflita(nomeA: string, nomeB: string): boolean {
  const a = extrairMarco(nomeA);
  const b = extrairMarco(nomeB);
  if (!a || !b) return false;
  return a.tipo !== b.tipo || a.n !== b.n;
}

/** Filtros compartilhados por list e mapa (mesma régua, pra as abas baterem). */
function montarWhereLocais(params: Omit<ListLocaisParams, keyof PaginationQuery>): Prisma.LocalWhereInput {
  const where: Prisma.LocalWhereInput = {};
  if (params.clienteId) where.clientes = { some: { clienteId: params.clienteId } };
  if (params.tipo) where.tipo = params.tipo;
  if (params.ativo === "true") where.ativo = true;
  else if (params.ativo === "false") where.ativo = false;
  else where.ativo = true;
  if (params.nivelConfianca) where.nivelConfianca = params.nivelConfianca;
  if (params.emValidacao === "true") {
    where.nivelConfianca = {
      in: [
        NivelConfiancaLocal.RASCUNHO,
        NivelConfiancaLocal.PRESENCA_PONTUAL,
        NivelConfiancaLocal.DWELL_CONFIRMADO,
      ],
    };
  }
  return where;
}

const LOCAL_INCLUDE = {
  clientes: {
    select: { cliente: { select: { id: true, nome: true } } },
    orderBy: { criadoEm: "asc" },
  },
  criadoPorMotorista: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
  _count: { select: { viagensCarga: true, viagensDescarga: true } },
} satisfies Prisma.LocalInclude;

type LocalRaw = Prisma.LocalGetPayload<{ include: typeof LOCAL_INCLUDE }>;

function flattenLocal<T extends LocalRaw>(local: T) {
  const { clientes, _count, ...rest } = local;
  return {
    ...rest,
    clientes: clientes.map((c) => c.cliente),
    totalViagens: _count.viagensCarga + _count.viagensDescarga,
  };
}

@Injectable()
export class LocaisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async list(params: ListLocaisParams) {
    const where = montarWhereLocais(params);
    const result = await paginate(this.prisma.local, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: quem barra o usuário restrito é o EscopoGuard.
      escopo: SEM_ESCOPO,
      searchFields: [...SEARCH_FIELDS],
      sortable: {
        nome: "nome",
        cidade: "cidade",
        uf: "uf",
        tipo: "tipo",
        ativo: "ativo",
        criadoEm: "criadoEm",
        nivelConfianca: "nivelConfianca",
      },
      defaultSort: { field: "nome", order: "asc" },
      include: LOCAL_INCLUDE,
    });
    return { ...result, data: (result.data as LocalRaw[]).map(flattenLocal) };
  }

  /**
   * Local ativo mais próximo de um ponto (lat/lng), dentro de `raioM`. Usado
   * pelo form de editar viagem pra sugerir o local a partir do GPS que o
   * motorista capturou no lançamento — antes isso varria a lista inteira
   * carregada no client (que sumiu com o autocomplete server-side). Prefiltra
   * por bounding-box e refina com haversine. Retorna null se nada dentro do raio.
   */
  async proximo(params: { lat: number; lng: number; raioM?: number; excluirId?: string }) {
    const raio = params.raioM ?? 500;
    const margem = raio * 1.1; // folga pra não descartar candidato antes do haversine
    const grausLat = margem / METROS_POR_GRAU_LAT;
    const grausLng =
      margem / (METROS_POR_GRAU_LAT * Math.max(Math.cos((params.lat * Math.PI) / 180), 0.01));

    const candidatos = await this.prisma.local.findMany({
      where: {
        ativo: true,
        lat: { gte: params.lat - grausLat, lte: params.lat + grausLat },
        lng: { gte: params.lng - grausLng, lte: params.lng + grausLng },
        ...(params.excluirId ? { id: { not: params.excluirId } } : {}),
      },
      select: { id: true, nome: true, cidade: true, uf: true, lat: true, lng: true },
    });

    let melhor: { id: string; nome: string; cidade: string; uf: string; dist: number } | null = null;
    for (const c of candidatos) {
      if (c.lat == null || c.lng == null) continue;
      const dist = haversineMetros(params.lat, params.lng, c.lat, c.lng);
      if (dist > raio) continue;
      if (!melhor || dist < melhor.dist) {
        melhor = { id: c.id, nome: c.nome, cidade: c.cidade, uf: c.uf, dist };
      }
    }
    return melhor;
  }

  async findOne(id: string) {
    const local = await this.prisma.local.findUniqueOrThrow({
      where: { id },
      include: LOCAL_INCLUDE,
    });
    return flattenLocal(local);
  }

  /**
   * Pontos das viagens que tiveram este local como DESCARGA. Plota a posição
   * REAL do "Estou no local de descarga" (descargaLat/descargaLng), com fallback
   * pro lat/lng da abertura do lançamento quando a viagem não tem captura de
   * descarga (viagens antigas / offline). O flag `origem` distingue os dois: só
   * pontos de descarga ficam de fato em cima do local; os de abertura podem cair
   * onde o motorista começou a preencher (balança/carga). Mais recentes primeiro,
   * limitado a 500 pra não pesar o mapa.
   */
  async lancamentos(id: string) {
    const LIMITE = 500;
    // Aceita viagem com GPS de descarga OU de abertura — antes filtrava só
    // lat/lng, o que excluía todo o PWA (que não envia lat/lng) e viagens só
    // com descargaLat.
    const where: Prisma.ViagemWhereInput = {
      localDescargaId: id,
      OR: [
        { descargaLat: { not: null }, descargaLng: { not: null } },
        { lat: { not: null }, lng: { not: null } },
      ],
    };
    const total = await this.prisma.viagem.count({ where });
    const viagens = await this.prisma.viagem.findMany({
      where,
      select: {
        id: true,
        lat: true,
        lng: true,
        descargaLat: true,
        descargaLng: true,
        descargaDistanciaMetros: true,
        data: true,
        ticket: true,
        status: true,
      },
      orderBy: { data: "desc" },
      take: LIMITE,
    });
    return {
      total,
      truncado: total > LIMITE,
      pontos: viagens.map((v) => {
        const temDescarga = v.descargaLat != null && v.descargaLng != null;
        return {
          id: v.id,
          lat: (temDescarga ? v.descargaLat : v.lat) as number,
          lng: (temDescarga ? v.descargaLng : v.lng) as number,
          origem: temDescarga ? ("descarga" as const) : ("abertura" as const),
          descargaDistanciaMetros: v.descargaDistanciaMetros,
          data: v.data,
          ticket: v.ticket,
          status: v.status,
        };
      }),
    };
  }

  /**
   * Dados pro modal de REVISÃO de duplicata: cada local do grupo (pin) + os
   * pontos de descarga das viagens de cada um (GPS real). Pra o admin bater o
   * olho e ver se os pontos coincidem antes de mesclar. Reusa a lógica de
   * `lancamentos()` (descarga com fallback pra abertura), pro grupo inteiro.
   */
  async duplicataMapa(ids: string[]) {
    const LIMITE = 800;
    const [locais, viagens] = await Promise.all([
      this.prisma.local.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true, lat: true, lng: true, tipo: true },
      }),
      this.prisma.viagem.findMany({
        where: {
          localDescargaId: { in: ids },
          OR: [
            { descargaLat: { not: null }, descargaLng: { not: null } },
            { lat: { not: null }, lng: { not: null } },
          ],
        },
        select: {
          localDescargaId: true,
          lat: true,
          lng: true,
          descargaLat: true,
          descargaLng: true,
        },
        orderBy: { data: "desc" },
        take: LIMITE,
      }),
    ]);

    const pontosDe = new Map<
      string,
      { lat: number; lng: number; origem: "descarga" | "abertura" }[]
    >();
    for (const v of viagens) {
      if (!v.localDescargaId) continue;
      const temDescarga = v.descargaLat != null && v.descargaLng != null;
      const arr = pontosDe.get(v.localDescargaId) ?? [];
      arr.push({
        lat: (temDescarga ? v.descargaLat : v.lat) as number,
        lng: (temDescarga ? v.descargaLng : v.lng) as number,
        origem: temDescarga ? "descarga" : "abertura",
      });
      pontosDe.set(v.localDescargaId, arr);
    }

    return locais.map((l) => ({
      id: l.id,
      nome: l.nome,
      lat: l.lat,
      lng: l.lng,
      tipo: l.tipo,
      pontos: pontosDe.get(l.id) ?? [],
    }));
  }

  /**
   * Lista enxuta pra exibição num mapa — só locais ativos com lat/lng,
   * sem paginação. Volume esperado: dezenas/centenas. Inclui clientes
   * achatado pro popup.
   */
  async mapa(params: ListLocaisParams) {
    const where: Prisma.LocalWhereInput = {
      ...montarWhereLocais(params),
      lat: { not: null },
      lng: { not: null },
    };
    if (params.q) {
      where.OR = SEARCH_FIELDS.map((f) => ({
        [f]: { contains: params.q, mode: "insensitive" },
      })) as Prisma.LocalWhereInput[];
    }
    const locais = await this.prisma.local.findMany({
      where,
      select: {
        id: true,
        nome: true,
        logradouro: true,
        numero: true,
        bairro: true,
        cidade: true,
        uf: true,
        tipo: true,
        lat: true,
        lng: true,
        nivelConfianca: true,
        origemCadastro: true,
        criadoEm: true,
        clientes: { select: { cliente: { select: { id: true, nome: true } } } },
        criadoPor: { select: { nome: true } },
        criadoPorMotorista: { select: { nome: true } },
        _count: { select: { viagensCarga: true, viagensDescarga: true } },
      },
      orderBy: { nome: "asc" },
    });
    return locais.map(
      ({ clientes, criadoPor, criadoPorMotorista, _count, ...l }) => ({
        ...l,
        clientes: clientes.map((c) => c.cliente),
        viagensCarga: _count.viagensCarga,
        viagensDescarga: _count.viagensDescarga,
        criadoPorNome: criadoPor?.nome ?? criadoPorMotorista?.nome ?? null,
      }),
    );
  }

  /**
   * Locais prováveis duplicados pra TARJA da lista. Regra geo-first:
   *  - locais COM coordenada: agrupa por PROXIMIDADE (raio {@link RAIO_DUPLICATA_M})
   *    reusando `duplicatasGeo`, que já aplica a trava de marco (estaca/km) — então
   *    rodovias/estacas distantes não são mais falso-positivo, e o mesmo pátio com
   *    nomes diferentes (ex.: "KM 172 …") é fundido.
   *  - locais SEM coordenada: fallback pelo trigram de nome (o geo não os enxerga).
   *
   * Principal (a manter) = maior qualidade (de `duplicatasGeo`), desempate por
   * viagens. `provavel_lixo` = candidato com ≤1 viagem quando o principal tem ≥2.
   * Só IDENTIFICA — a mesclagem continua manual.
   */
  async duplicatas() {
    type Similar = {
      id: string;
      nome: string;
      totalViagens: number;
      distanciaM: number | null;
      tipo: TipoLocal;
    };
    type Entry = Similar & {
      grupoId: string;
      papel: "provavel_lixo" | "duplicata";
      similares: Similar[];
    };
    const resultado: Entry[] = [];

    // 1) Geo-first: grupos por proximidade (+ trava de marco já embutida).
    const geo = await this.duplicatasGeo(RAIO_DUPLICATA_M);
    for (const g of geo.grupos) {
      const membros = [g.principal, ...g.candidatos];
      const maxViagens = Math.max(...membros.map((m) => m.totalViagens));
      for (const m of membros) {
        const similares: Similar[] = membros
          .filter((o) => o.id !== m.id)
          .map((o) => ({
            id: o.id,
            nome: o.nome,
            totalViagens: o.totalViagens,
            tipo: o.tipo,
            distanciaM:
              m.lat != null && m.lng != null && o.lat != null && o.lng != null
                ? Math.round(haversineMetros(m.lat, m.lng, o.lat, o.lng))
                : null,
          }))
          .sort((a, b) => (a.distanciaM ?? Infinity) - (b.distanciaM ?? Infinity));
        const ehLixo =
          m.totalViagens <= 1 && maxViagens >= 2 && m.id !== g.principal.id;
        resultado.push({
          id: m.id,
          nome: m.nome,
          totalViagens: m.totalViagens,
          tipo: m.tipo,
          distanciaM: null,
          grupoId: g.id,
          papel: ehLixo ? "provavel_lixo" : "duplicata",
          similares,
        });
      }
    }

    // 2) Fallback por NOME só entre locais SEM coordenada (fora do alcance do geo).
    const paresNome = await this.prisma.$queryRaw<{ id_a: string; id_b: string }[]>`
      SELECT a.id AS id_a, b.id AS id_b
      FROM "locais" a
      JOIN "locais" b
        ON a.id < b.id
       AND a.ativo = true AND b.ativo = true
       AND (a.lat IS NULL OR a.lng IS NULL)
       AND (b.lat IS NULL OR b.lng IS NULL)
       AND public.f_normalizar(a.nome) % public.f_normalizar(b.nome)
      WHERE similarity(public.f_normalizar(a.nome), public.f_normalizar(b.nome)) >= 0.5
    `;
    if (paresNome.length > 0) {
      const ids = [...new Set(paresNome.flatMap((p) => [p.id_a, p.id_b]))];
      const infos = await this.prisma.local.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          nome: true,
          tipo: true,
          _count: { select: { viagensCarga: true, viagensDescarga: true } },
        },
      });
      const nomeDe = new Map(infos.map((l) => [l.id, l.nome]));
      const tipoDe = new Map(infos.map((l) => [l.id, l.tipo]));
      const viagensDe = new Map(
        infos.map((l) => [l.id, l._count.viagensCarga + l._count.viagensDescarga]),
      );

      const parent = new Map<string, string>();
      const find = (x: string): string => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r) as string;
        let cur = x;
        while (parent.get(cur) !== r) {
          const next = parent.get(cur) as string;
          parent.set(cur, r);
          cur = next;
        }
        return r;
      };
      const ensure = (x: string) => {
        if (!parent.has(x)) parent.set(x, x);
      };
      const union = (a: string, b: string) => {
        ensure(a);
        ensure(b);
        parent.set(find(a), find(b));
      };
      for (const p of paresNome) union(p.id_a, p.id_b);

      const grupos = new Map<string, string[]>();
      for (const id of parent.keys()) {
        const raiz = find(id);
        const arr = grupos.get(raiz);
        if (arr) arr.push(id);
        else grupos.set(raiz, [id]);
      }
      for (const [grupoId, gids] of grupos) {
        if (gids.length < 2) continue;
        const membros = gids.map((id) => ({
          id,
          nome: nomeDe.get(id) ?? "",
          totalViagens: viagensDe.get(id) ?? 0,
          tipo: tipoDe.get(id) ?? TipoLocal.DESCARGA,
        }));
        const maxViagens = Math.max(...membros.map((m) => m.totalViagens));
        const forteId = membros.reduce((a, b) =>
          b.totalViagens > a.totalViagens ? b : a,
        ).id;
        for (const m of membros) {
          const ehLixo =
            m.totalViagens <= 1 && maxViagens >= 2 && m.id !== forteId;
          const similares: Similar[] = membros
            .filter((o) => o.id !== m.id)
            .map((o) => ({ ...o, distanciaM: null }))
            .sort((a, b) => b.totalViagens - a.totalViagens);
          resultado.push({
            id: m.id,
            nome: m.nome,
            totalViagens: m.totalViagens,
            tipo: m.tipo,
            distanciaM: null,
            grupoId: `n-${grupoId}`,
            papel: ehLixo ? "provavel_lixo" : "duplicata",
            similares,
          });
        }
      }
    }

    return resultado;
  }

  /** Raio inicial de busca configurado (metros). Fallback 50 (default antigo). */
  private async raioBuscaAtual(): Promise<number> {
    const cfg = await this.prisma.configuracaoBuscaLocais.findUnique({
      where: { id: "default" },
      select: { raioInicialM: true },
    });
    return cfg?.raioInicialM ?? 50;
  }

  private static haversineM(
    latA: number,
    lngA: number,
    latB: number,
    lngB: number,
  ): number {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(latB - latA);
    const dLng = toRad(lngB - lngA);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  private static readonly NIVEL_RANK: Record<NivelConfiancaLocal, number> = {
    RASCUNHO: 0,
    PRESENCA_PONTUAL: 1,
    DWELL_CONFIRMADO: 2,
    RECORRENTE: 3,
    HUMANO: 4,
  };

  /**
   * Grupos de locais ativos GEOGRAFICAMENTE próximos (prováveis duplicados do
   * mesmo lugar físico), com sinais de qualidade por local. Recomenda como
   * "principal" (a manter) quem foi cadastrado online / com endereço / mais
   * usado; os demais viram candidatos a duplicado. Ordena os grupos por
   * gravidade. Só IDENTIFICA — não automatiza nada. Ferramenta de limpeza do
   * passivo criado com o raio antigo de 50m + cadastros offline.
   */
  async duplicatasGeo(raioM = 200) {
    const raio = Math.min(Math.max(Math.round(raioM) || 200, 20), 5000);
    // Margem generosa no bounding-box (pré-filtro barato); o haversine no WHERE
    // é o corte exato. ~1 grau ≈ 111.320m; /90000 dá folga pra não excluir par.
    const grau = raio / 90000;
    const raioAtual = await this.raioBuscaAtual();

    const paresRaw = await this.prisma.$queryRaw<
      { id_a: string; id_b: string; nome_a: string; nome_b: string }[]
    >`
      SELECT a.id AS id_a, b.id AS id_b, a.nome AS nome_a, b.nome AS nome_b
      FROM "locais" a
      JOIN "locais" b
        ON a.id < b.id
       AND a.ativo = true AND b.ativo = true
       AND a.lat IS NOT NULL AND a.lng IS NOT NULL
       AND b.lat IS NOT NULL AND b.lng IS NOT NULL
       AND b.lat BETWEEN a.lat - ${grau} AND a.lat + ${grau}
       AND b.lng BETWEEN a.lng - ${grau} AND a.lng + ${grau}
      WHERE (6371000 * 2 * asin(sqrt(
          power(sin(radians(b.lat - a.lat) / 2), 2) +
          cos(radians(a.lat)) * cos(radians(b.lat)) *
          power(sin(radians(b.lng - a.lng) / 2), 2)
        ))) <= ${raio}
    `;
    // Trava de marco: descarta pares perto mas com estaca/km diferentes (pontos
    // de rodovia/obra distintos de propósito — não são duplicata).
    const pares = paresRaw.filter((p) => !marcoConflita(p.nome_a, p.nome_b));
    if (pares.length === 0) return { raioM: raio, raioAtualBusca: raioAtual, grupos: [] };

    // Union-find → componentes conexos (mesmo padrão do duplicatas() por nome).
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r) as string;
      let cur = x;
      while (parent.get(cur) !== r) {
        const nx = parent.get(cur) as string;
        parent.set(cur, r);
        cur = nx;
      }
      return r;
    };
    const ensure = (x: string) => {
      if (!parent.has(x)) parent.set(x, x);
    };
    const union = (a: string, b: string) => {
      ensure(a);
      ensure(b);
      parent.set(find(a), find(b));
    };
    for (const p of pares) union(p.id_a, p.id_b);

    const gruposIds = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const raiz = find(id);
      const arr = gruposIds.get(raiz);
      if (arr) arr.push(id);
      else gruposIds.set(raiz, [id]);
    }
    const idsCluster = [...parent.keys()];

    // Sinais: dados dos locais + motoristas distintos (evidência) + descargas
    // fora do raio de busca atual (marcação solta / centróide provavelmente errado).
    const [locais, evid, descargas] = await Promise.all([
      this.prisma.local.findMany({
        where: { id: { in: idsCluster } },
        select: {
          id: true,
          nome: true,
          lat: true,
          lng: true,
          tipo: true,
          logradouro: true,
          numero: true,
          bairro: true,
          cidade: true,
          uf: true,
          apelidos: true,
          latLngPrecisao: true,
          latLngFonte: true,
          origemCadastro: true,
          nivelConfianca: true,
          criadoEm: true,
          criadoPorMotorista: { select: { id: true, nome: true } },
          clientes: { select: { cliente: { select: { id: true, nome: true } } } },
          _count: { select: { viagensCarga: true, viagensDescarga: true } },
        },
      }),
      this.prisma.$queryRaw<{ localId: string; m: bigint }[]>`
        SELECT "localId", count(DISTINCT "motoristaId") AS m
        FROM "local_evidencia" WHERE "localId" = ANY(${idsCluster}) GROUP BY "localId"
      `,
      this.prisma.$queryRaw<{ localId: string; fora: bigint; total: bigint }[]>`
        SELECT "localDescargaId" AS "localId",
               count(*) FILTER (WHERE "descargaDistanciaMetros" > ${raioAtual}) AS fora,
               count(*) FILTER (WHERE "descargaDistanciaMetros" IS NOT NULL) AS total
        FROM "viagens" WHERE "localDescargaId" = ANY(${idsCluster}) GROUP BY "localDescargaId"
      `,
    ]);

    const motoristasDe = new Map(evid.map((e) => [e.localId, Number(e.m)]));
    const descargaDe = new Map(
      descargas.map((d) => [d.localId, { fora: Number(d.fora), total: Number(d.total) }]),
    );

    const enriquecer = (l: (typeof locais)[number]) => {
      const endereco = [l.logradouro, l.numero, l.bairro, l.cidade, l.uf]
        .map((x) => (x ?? "").trim())
        .filter(Boolean)
        .join(", ");
      const totalViagens = l._count.viagensCarga + l._count.viagensDescarga;
      const offline =
        l.origemCadastro === OrigemCadastroLocal.VIAGEM_OFFLINE || l.latLngFonte === "CACHE";
      const semEndereco = endereco.trim().length === 0;
      const rascunho = l.nivelConfianca === NivelConfiancaLocal.RASCUNHO;
      const motoristasDistintos = motoristasDe.get(l.id) ?? 0;
      const d = descargaDe.get(l.id);
      const pctDescargaForaRaio = d && d.total > 0 ? Math.round((d.fora / d.total) * 100) : null;
      // Qualidade (maior = melhor candidato a "principal" a manter). Prioriza
      // online + endereço + uso + confiança.
      const qualidade =
        (semEndereco ? 0 : 100) +
        (l.origemCadastro === OrigemCadastroLocal.VIAGEM_OFFLINE ? 0 : 60) +
        (l.latLngFonte === "CACHE" ? 0 : 40) +
        LocaisService.NIVEL_RANK[l.nivelConfianca] * 20 +
        Math.min(totalViagens, 50) * 2 +
        motoristasDistintos * 10 +
        (l.latLngPrecisao != null ? Math.max(0, 30 - l.latLngPrecisao / 5) : 15);
      return {
        id: l.id,
        nome: l.nome,
        lat: l.lat,
        lng: l.lng,
        tipo: l.tipo,
        endereco,
        apelidos: l.apelidos,
        clientes: l.clientes.map((c) => c.cliente),
        totalViagens,
        latLngPrecisao: l.latLngPrecisao,
        latLngFonte: l.latLngFonte,
        origemCadastro: l.origemCadastro,
        nivelConfianca: l.nivelConfianca,
        criadoEm: l.criadoEm,
        criadoPorMotorista: l.criadoPorMotorista,
        motoristasDistintos,
        pctDescargaForaRaio,
        flags: { offline, semEndereco, rascunho, poucasViagens: totalViagens <= 1 },
        qualidade,
      };
    };

    const porId = new Map(locais.map((l) => [l.id, enriquecer(l)]));

    type Local = ReturnType<typeof enriquecer>;
    const grupos: Array<{
      id: string;
      centroide: { lat: number; lng: number };
      gravidade: number;
      principal: Local & { distanciaDoPrincipalM: number };
      candidatos: Array<Local & { distanciaDoPrincipalM: number }>;
    }> = [];

    for (const [grupoId, ids] of gruposIds) {
      const membros = ids.map((id) => porId.get(id)).filter((x): x is Local => !!x);
      if (membros.length < 2) continue;
      // Principal = maior qualidade (desempate: mais viagens).
      const principal = membros.reduce((a, b) =>
        b.qualidade > a.qualidade || (b.qualidade === a.qualidade && b.totalViagens > a.totalViagens)
          ? b
          : a,
      );
      const comDist = (m: Local) => ({
        ...m,
        distanciaDoPrincipalM:
          m.lat != null && m.lng != null && principal.lat != null && principal.lng != null
            ? Math.round(LocaisService.haversineM(principal.lat, principal.lng, m.lat, m.lng))
            : 0,
      });
      const candidatos = membros
        .filter((m) => m.id !== principal.id)
        .map(comDist)
        .sort((a, b) => a.distanciaDoPrincipalM - b.distanciaDoPrincipalM);
      const lats = membros.map((m) => m.lat ?? 0);
      const lngs = membros.map((m) => m.lng ?? 0);
      const centroide = {
        lat: lats.reduce((s, v) => s + v, 0) / membros.length,
        lng: lngs.reduce((s, v) => s + v, 0) / membros.length,
      };
      const offlineCount = candidatos.filter((c) => c.flags.offline).length;
      const semEnderecoCount = candidatos.filter((c) => c.flags.semEndereco).length;
      const viagensGrupo = membros.reduce((s, m) => s + m.totalViagens, 0);
      const gravidade =
        (membros.length - 1) * 10 +
        offlineCount * 15 +
        semEnderecoCount * 8 +
        Math.min(viagensGrupo, 100);
      grupos.push({ id: grupoId, centroide, gravidade, principal: comDist(principal), candidatos });
    }

    grupos.sort((a, b) => b.gravidade - a.gravidade);
    return { raioM: raio, raioAtualBusca: raioAtual, grupos };
  }

  /**
   * Admin homologa manualmente — sobe pra HUMANO (top da hierarquia).
   */
  async homologar(id: string) {
    await this.ensureExists(id);
    await this.prisma.localEvidencia.create({
      data: {
        localId: id,
        // ADMIN não tem motorista; usa um motorista "sentinela" só pro audit?
        // Simplifica: não exige motoristaId pra fonte ADMIN. Reusa o primeiro
        // motorista do banco como placeholder pra não quebrar o FK.
        // → Alternativa melhor: pular o LocalEvidencia pra fonte ADMIN, só
        // atualizar o Local direto.
        motoristaId: await this.algumMotoristaId(),
        fonte: FonteEvidencia.ADMIN,
      },
    }).catch(() => {
      /* sem motorista no banco — segue sem audit */
    });
    return this.prisma.local.update({
      where: { id },
      data: {
        nivelConfianca: NivelConfiancaLocal.HUMANO,
        ultimaValidacaoEm: new Date(),
      },
    });
  }

  /**
   * Mescla local "origem" no "destino": move viagens (carga e descarga) pro
   * destino e apaga o origem. Útil pra eliminar duplicatas que escaparam do
   * pre-check de 200m.
   */
  async mesclar(origemId: string, destinoId: string, usuarioId?: string) {
    if (origemId === destinoId) {
      throw new ConflictException("Origem e destino são o mesmo local");
    }
    const [origem, destino] = await Promise.all([
      this.prisma.local.findUnique({
        where: { id: origemId },
        include: { clientes: { select: { clienteId: true } } },
      }),
      this.prisma.local.findUnique({
        where: { id: destinoId },
        include: { clientes: { select: { clienteId: true } } },
      }),
    ]);
    if (!origem) throw new NotFoundException("Local de origem não encontrado");
    if (!destino) throw new NotFoundException("Local de destino não encontrado");

    // Consolida no destino ANTES de apagar o origem: apelidos (importantes pro
    // agente de WhatsApp casar o nome que o motorista usa) e clientes vinculados
    // — hoje o merge jogava isso fora.
    const apelidosFinais = [...new Set([...(destino.apelidos ?? []), ...(origem.apelidos ?? [])])];
    const clientesDestino = new Set(destino.clientes.map((c) => c.clienteId));
    const clientesFaltando = origem.clientes
      .map((c) => c.clienteId)
      .filter((id) => !clientesDestino.has(id));

    const results = await this.prisma.$transaction([
      this.prisma.viagem.updateMany({
        where: { localCargaId: origemId },
        data: { localCargaId: destinoId },
      }),
      this.prisma.viagem.updateMany({
        where: { localDescargaId: origemId },
        data: { localDescargaId: destinoId },
      }),
      // Trechos (retorno do bota-fora) apontam pro local via FK RESTRICT — sem
      // reatribuir, o delete do origem estoura trechos_viagem_localId_fkey.
      this.prisma.trechoViagem.updateMany({
        where: { localId: origemId },
        data: { localId: destinoId },
      }),
      // Eventos da viagem guiada (FK SetNull) — reatribui pra não perder o
      // vínculo do local ao apagar o origem.
      this.prisma.eventoViagem.updateMany({
        where: { localId: origemId },
        data: { localId: destinoId },
      }),
      this.prisma.local.update({
        where: { id: destinoId },
        data: { apelidos: apelidosFinais },
      }),
      ...(clientesFaltando.length
        ? [
            this.prisma.localCliente.createMany({
              data: clientesFaltando.map((clienteId) => ({ localId: destinoId, clienteId })),
            }),
          ]
        : []),
      this.prisma.rotaCache.deleteMany({
        where: { OR: [{ localOrigemId: origemId }, { localDestinoId: origemId }] },
      }),
      this.prisma.local.delete({ where: { id: origemId } }),
    ]);
    const viagensMovidas =
      (results[0] as { count: number }).count + (results[1] as { count: number }).count;

    await this.auditoria
      .log({
        usuarioId: usuarioId ?? null,
        entidade: "Local",
        entidadeId: destinoId,
        acao: AcaoAuditoria.MESCLAR_LOCAL,
        valorAntes: { id: origemId, nome: origem.nome },
        valorDepois: { id: destinoId, nome: destino.nome },
        metadata: {
          viagensMovidas,
          apelidosAdicionados: apelidosFinais.length - (destino.apelidos?.length ?? 0),
          clientesAdicionados: clientesFaltando.length,
        },
      })
      .catch(() => {
        /* auditoria best-effort não bloqueia o merge */
      });
    return { ok: true, viagensMovidas };
  }

  private async algumMotoristaId(): Promise<string> {
    const m = await this.prisma.motorista.findFirst({ select: { id: true } });
    if (!m) throw new ConflictException("Nenhum motorista cadastrado");
    return m.id;
  }

  async create(data: CriarLocalInput, usuarioId: string) {
    const { clienteIds, ...rest } = data;
    const local = await this.prisma.local.create({
      data: {
        ...(rest as Prisma.LocalUncheckedCreateInput),
        criadoPorId: usuarioId,
        origemCadastro: OrigemCadastroLocal.ADMIN_MANUAL,
        clientes: clienteIds.length
          ? { create: clienteIds.map((clienteId) => ({ clienteId })) }
          : undefined,
      },
      include: LOCAL_INCLUDE,
    });
    return flattenLocal(local);
  }

  async update(
    id: string,
    data: Partial<CriarLocalInput> & { ativo?: boolean },
  ) {
    await this.ensureExists(id);
    const { clienteIds, ...rest } = data;
    const local = await this.prisma.$transaction(async (tx) => {
      if (clienteIds !== undefined) {
        await tx.localCliente.deleteMany({ where: { localId: id } });
        if (clienteIds.length) {
          await tx.localCliente.createMany({
            data: clienteIds.map((clienteId) => ({ localId: id, clienteId })),
          });
        }
      }
      return tx.local.update({
        where: { id },
        data: rest as Prisma.LocalUncheckedUpdateInput,
        include: LOCAL_INCLUDE,
      });
    });
    return flattenLocal(local);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [carga, descarga, trechos] = await Promise.all([
      this.prisma.viagem.count({ where: { localCargaId: id } }),
      this.prisma.viagem.count({ where: { localDescargaId: id } }),
      // Trechos (retorno do bota-fora) têm FK RESTRICT — sem contar aqui, o
      // delete estouraria 500 em vez de um 4xx claro (raro: trecho órfão da
      // carga trocada depois).
      this.prisma.trechoViagem.count({ where: { localId: id } }),
    ]);
    const total = carga + descarga + trechos;
    if (total > 0) {
      const trechoTxt = trechos > 0 ? `, ${trechos} de retorno` : "";
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${total} viagem${total === 1 ? "" : "s"} (${carga} de carga, ${descarga} de descarga${trechoTxt}). Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    // RotaCache sai cascade via schema
    await this.prisma.local.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const l = await this.prisma.local.findUnique({ where: { id } });
    if (!l) throw new NotFoundException("Local não encontrado");
    return l;
  }
}
