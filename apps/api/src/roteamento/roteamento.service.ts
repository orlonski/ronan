import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const CACHE_TTL_DIAS = 90;
// Timeout por-tentativa. A cascata curb→sem-curb pode fazer até 2 chamadas; com
// 3.5s cada o pior caso (~7s) ainda cabe no lançamento. Na prática a 1ª resolve.
const HTTP_TIMEOUT_MS = 3500;

// Versão do roteador. Bumpar sempre que a forma de calcular a rota mudar (ex.:
// ligar approaches=curb) invalida o RotaCache antigo de forma lazy: entradas de
// versão diferente viram stale e são recomputadas no próximo acesso.
const ROUTER_VERSION = 3;

// approaches=curb;curb força o roteador a chegar/sair no lado correto da via
// (mão-direita no Brasil), contando o retorno quando o ponto de carga/descarga
// caiu na pista de sentido contrário. Se o build do OSRM não suportar o
// parâmetro, definir OSRM_APPROACHES="off" desliga sem mexer no código.
const OSRM_APPROACHES = (process.env.OSRM_APPROACHES ?? "curb;curb").trim();

// Diferença mínima (km) entre a variante COM retorno (curb) e SEM retorno pra
// valer a pena perguntar ao motorista. Abaixo disso, o ponto já está do lado
// certo (sem retorno real) → devolve 1 opção só, sem escolha/fricção.
const LIMIAR_DEDUP_KM = 0.3;

type OsrmRoute = { distance: number; duration: number; geometry?: string };
type OsrmResponse = { code: string; routes?: OsrmRoute[] };

type RotaResult =
  | {
      km: string;
      duracaoSegundos: number;
      geometria: string | null;
      fonte: "osrm" | "cache";
    }
  | { km: null; erro: string };

export type RotaOption = {
  km: string;
  duracaoSegundos: number;
  geometria: string | null;
  /** True pra routes[0] (a "melhor" pelo custo OSRM) — a mesma que calcularKm pega. */
  recomendada: boolean;
  /**
   * Só preenchido por `calcularComSemRetorno`: true = variante COM retorno
   * (approaches=curb, conta o retorno na pista dupla), false = SEM retorno
   * (segue direto). Ausente nas alternativas normais (eixo de estrada, não retorno).
   */
  retorno?: boolean;
};

export type AlternativasResult = { rotas: RotaOption[] } | { rotas: []; erro: string };

@Injectable()
export class RoteamentoService {
  private readonly logger = new Logger(RoteamentoService.name);
  private readonly osrmUrl = process.env.OSRM_URL ?? "";

  constructor(private readonly prisma: PrismaService) {}

  async calcularKm(
    localOrigemId: string,
    localDestinoId: string,
    opts: { force?: boolean } = {},
  ): Promise<RotaResult> {
    if (localOrigemId === localDestinoId) {
      return { km: "0.00", duracaoSegundos: 0, geometria: null, fonte: "cache" };
    }

    const cached = await this.prisma.rotaCache.findUnique({
      where: {
        localOrigemId_localDestinoId: { localOrigemId, localDestinoId },
      },
    });
    if (
      !opts.force &&
      cached &&
      cached.versaoRoteador === ROUTER_VERSION &&
      this.cacheValido(cached.calculadoEm)
    ) {
      return {
        km: cached.km.toString(),
        duracaoSegundos: cached.duracaoSegundos,
        geometria: cached.geometria,
        fonte: "cache",
      };
    }

    const [origem, destino] = await Promise.all([
      this.prisma.local.findUnique({
        where: { id: localOrigemId },
        select: { lat: true, lng: true },
      }),
      this.prisma.local.findUnique({
        where: { id: localDestinoId },
        select: { lat: true, lng: true },
      }),
    ]);

    if (!origem?.lat || !origem?.lng || !destino?.lat || !destino?.lng) {
      return {
        km: null,
        erro: "Local sem coordenadas. Cadastre o endereço completo.",
      };
    }

    if (!this.osrmUrl) {
      return { km: null, erro: "Servidor de rotas não configurado." };
    }

    try {
      const route = await this.consultarOsrm(
        origem.lat,
        origem.lng,
        destino.lat,
        destino.lng,
      );
      const kmNum = route.distance / 1000;
      const km = kmNum.toFixed(2);
      const geometria = route.geometry ?? null;

      await this.prisma.rotaCache.upsert({
        where: {
          localOrigemId_localDestinoId: { localOrigemId, localDestinoId },
        },
        create: {
          localOrigemId,
          localDestinoId,
          km: new Prisma.Decimal(km),
          duracaoSegundos: Math.round(route.duration),
          geometria,
          versaoRoteador: ROUTER_VERSION,
        },
        update: {
          km: new Prisma.Decimal(km),
          duracaoSegundos: Math.round(route.duration),
          geometria,
          versaoRoteador: ROUTER_VERSION,
          calculadoEm: new Date(),
        },
      });

      return {
        km,
        duracaoSegundos: Math.round(route.duration),
        geometria,
        fonte: "osrm",
      };
    } catch (err) {
      this.logger.warn(
        `OSRM falhou ${localOrigemId}->${localDestinoId}: ${(err as Error).message}`,
      );
      return { km: null, erro: "Não foi possível calcular a rota agora." };
    }
  }

  /**
   * Calcula ATÉ 3 rotas alternativas carga→descarga (OSRM `alternatives=3`).
   * Online-only: não lê cache antes (queremos as alternativas frescas). Atualiza
   * o RotaCache com routes[0] (recomendada) pra manter o default coerente com o
   * que calcularKm devolveria. NÃO cacheia a lista inteira. OSRM pode devolver
   * só 1 rota (sem alternativa real) → lista de 1.
   */
  async calcularAlternativas(
    localOrigemId: string,
    localDestinoId: string,
  ): Promise<AlternativasResult> {
    if (localOrigemId === localDestinoId) {
      return {
        rotas: [{ km: "0.00", duracaoSegundos: 0, geometria: null, recomendada: true }],
      };
    }

    const [origem, destino] = await Promise.all([
      this.prisma.local.findUnique({
        where: { id: localOrigemId },
        select: { lat: true, lng: true },
      }),
      this.prisma.local.findUnique({
        where: { id: localDestinoId },
        select: { lat: true, lng: true },
      }),
    ]);

    if (!origem?.lat || !origem?.lng || !destino?.lat || !destino?.lng) {
      return {
        rotas: [],
        erro: "Local sem coordenadas. Cadastre o endereço completo.",
      };
    }

    if (!this.osrmUrl) {
      return { rotas: [], erro: "Servidor de rotas não configurado." };
    }

    try {
      const routes = await this.consultarOsrmAlternativas(
        origem.lat,
        origem.lng,
        destino.lat,
        destino.lng,
      );

      const rotas: RotaOption[] = routes.map((route, idx) => ({
        km: (route.distance / 1000).toFixed(2),
        duracaoSegundos: Math.round(route.duration),
        geometria: route.geometry ?? null,
        recomendada: idx === 0,
      }));

      // Mantém o cache do par batendo com a recomendada (routes[0]).
      const recomendada = rotas[0]!;
      await this.prisma.rotaCache.upsert({
        where: {
          localOrigemId_localDestinoId: { localOrigemId, localDestinoId },
        },
        create: {
          localOrigemId,
          localDestinoId,
          km: new Prisma.Decimal(recomendada.km),
          duracaoSegundos: recomendada.duracaoSegundos,
          geometria: recomendada.geometria,
          versaoRoteador: ROUTER_VERSION,
        },
        update: {
          km: new Prisma.Decimal(recomendada.km),
          duracaoSegundos: recomendada.duracaoSegundos,
          geometria: recomendada.geometria,
          versaoRoteador: ROUTER_VERSION,
          calculadoEm: new Date(),
        },
      });

      return { rotas };
    } catch (err) {
      this.logger.warn(
        `OSRM alternativas falhou ${localOrigemId}->${localDestinoId}: ${(err as Error).message}`,
      );
      return { rotas: [], erro: "Não foi possível calcular as rotas agora." };
    }
  }

  /**
   * Duas variantes da MESMA rota carga→descarga: COM retorno (approaches=curb,
   * conta o retorno na pista dupla) e SEM retorno (segue direto). Serve pro app
   * deixar o motorista escolher o que aconteceu de verdade — em pista simples o
   * curb pode "achar" um retorno que não houve.
   *
   * Online-only, 2 chamadas OSRM em paralelo (allSettled — timeout/erro de uma
   * não derruba a outra). DEDUP: se as duas quase batem (delta <= LIMIAR_DEDUP_KM)
   * → colapsa pra 1 opção (com_retorno), sem escolha no caso comum. Ordem estável
   * [sem_retorno, com_retorno] (o app restaura a escolha por índice). Cacheia a
   * com_retorno (curb) como default, coerente com calcularKm/reprocessamento.
   */
  async calcularComSemRetorno(
    localOrigemId: string,
    localDestinoId: string,
  ): Promise<AlternativasResult> {
    if (localOrigemId === localDestinoId) {
      return {
        rotas: [
          { km: "0.00", duracaoSegundos: 0, geometria: null, recomendada: true, retorno: true },
        ],
      };
    }

    const [origem, destino] = await Promise.all([
      this.prisma.local.findUnique({
        where: { id: localOrigemId },
        select: { lat: true, lng: true },
      }),
      this.prisma.local.findUnique({
        where: { id: localDestinoId },
        select: { lat: true, lng: true },
      }),
    ]);

    if (!origem?.lat || !origem?.lng || !destino?.lat || !destino?.lng) {
      return { rotas: [], erro: "Local sem coordenadas. Cadastre o endereço completo." };
    }
    if (!this.osrmUrl) {
      return { rotas: [], erro: "Servidor de rotas não configurado." };
    }

    const coords = `${origem.lng},${origem.lat};${destino.lng},${destino.lat}`;
    const base = `${this.osrmUrl}/route/v1/driving/${coords}?overview=full&geometries=polyline`;
    const usarApproaches =
      OSRM_APPROACHES !== "" && OSRM_APPROACHES.toLowerCase() !== "off";

    const toOption = (route: OsrmRoute, retorno: boolean, recomendada: boolean): RotaOption => ({
      km: (route.distance / 1000).toFixed(2),
      duracaoSegundos: Math.round(route.duration),
      geometria: route.geometry ?? null,
      recomendada,
      retorno,
    });

    try {
      // Sem curb ligado não existe variante "com retorno" distinta: 1 rota só.
      if (!usarApproaches) {
        const res = await this.fetchOsrm(base);
        if (res.code !== "Ok" || !res.routes?.[0]) {
          return { rotas: [], erro: "Não foi possível calcular as rotas agora." };
        }
        const only = toOption(res.routes[0], false, true);
        await this.upsertCache(localOrigemId, localDestinoId, only);
        return { rotas: [only] };
      }

      const [comRes, semRes] = await Promise.allSettled([
        this.fetchOsrm(`${base}&approaches=${encodeURIComponent(OSRM_APPROACHES)}`),
        this.fetchOsrm(base),
      ]);
      const comRoute =
        comRes.status === "fulfilled" && comRes.value.code === "Ok"
          ? comRes.value.routes?.[0]
          : undefined;
      const semRoute =
        semRes.status === "fulfilled" && semRes.value.code === "Ok"
          ? semRes.value.routes?.[0]
          : undefined;

      if (!comRoute && !semRoute) {
        return { rotas: [], erro: "Não foi possível calcular as rotas agora." };
      }

      let rotas: RotaOption[];
      let paraCache: RotaOption;

      if (comRoute && semRoute) {
        const comOpt = toOption(comRoute, true, true);
        const semOpt = toOption(semRoute, false, false);
        const delta = parseFloat(comOpt.km) - parseFloat(semOpt.km);
        // delta pode vir levemente negativo (curb corrige pro lado certo e encurta);
        // só oferecemos escolha quando o retorno adiciona km de verdade.
        rotas = delta > LIMIAR_DEDUP_KM ? [semOpt, comOpt] : [comOpt];
        paraCache = comOpt;
      } else {
        // Só uma respondeu (ex.: curb deu NoRoute naquele trecho → só sem_retorno,
        // igual ao fallback de calcularKm). Vira a única opção e o default do cache.
        const only = comRoute
          ? toOption(comRoute, true, true)
          : toOption(semRoute!, false, true);
        rotas = [only];
        paraCache = only;
      }

      await this.upsertCache(localOrigemId, localDestinoId, paraCache);
      return { rotas };
    } catch (err) {
      this.logger.warn(
        `OSRM opções falhou ${localOrigemId}->${localDestinoId}: ${(err as Error).message}`,
      );
      return { rotas: [], erro: "Não foi possível calcular as rotas agora." };
    }
  }

  /** Upsert do RotaCache com uma RotaOption como default do par (versão atual). */
  private async upsertCache(
    localOrigemId: string,
    localDestinoId: string,
    rota: RotaOption,
  ): Promise<void> {
    await this.prisma.rotaCache.upsert({
      where: { localOrigemId_localDestinoId: { localOrigemId, localDestinoId } },
      create: {
        localOrigemId,
        localDestinoId,
        km: new Prisma.Decimal(rota.km),
        duracaoSegundos: rota.duracaoSegundos,
        geometria: rota.geometria,
        versaoRoteador: ROUTER_VERSION,
      },
      update: {
        km: new Prisma.Decimal(rota.km),
        duracaoSegundos: rota.duracaoSegundos,
        geometria: rota.geometria,
        versaoRoteador: ROUTER_VERSION,
        calculadoEm: new Date(),
      },
    });
  }

  private cacheValido(calculadoEm: Date): boolean {
    const idadeMs = Date.now() - calculadoEm.getTime();
    return idadeMs < CACHE_TTL_DIAS * 24 * 60 * 60 * 1000;
  }

  private async consultarOsrm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): Promise<OsrmRoute> {
    // overview=full retorna a polyline encoded (precision 5) com todos os pontos
    // da rota — a linha acompanha a rodovia curva a curva (simplified cortava as
    // curvas com ~dezenas de pontos). Sem custo extra de requisição.
    const routes = await this.rotearOsrm(`${lng1},${lat1};${lng2},${lat2}`, "");
    return routes[0]!;
  }

  private async consultarOsrmAlternativas(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): Promise<OsrmRoute[]> {
    // alternatives=3 pede até 3 rotas distintas. OSRM pode devolver menos (ou
    // só 1) quando não há alternativa razoável. routes[0] = a recomendada.
    return this.rotearOsrm(`${lng1},${lat1};${lng2},${lat2}`, "&alternatives=3");
  }

  /**
   * Consulta o OSRM com cascata de resiliência para o approaches=curb:
   *  1. tenta com approaches (lado correto da via, contando retorno);
   *  2. se a resposta veio 200 mas sem rota (NoRoute/NoSegment — restrição de
   *     lado impossível naquele trecho de OSM), degrada pra query SEM approaches
   *     (comportamento antigo). Só aí um code != Ok vira erro pro chamador.
   * Falha de rede/HTTP/timeout (OSRM fora do ar) propaga direto — não faz sentido
   * repetir com outro parâmetro e gastar mais um timeout.
   */
  private async rotearOsrm(coords: string, extraParams: string): Promise<OsrmRoute[]> {
    const base = `${this.osrmUrl}/route/v1/driving/${coords}?overview=full&geometries=polyline${extraParams}`;
    const usarApproaches =
      OSRM_APPROACHES !== "" && OSRM_APPROACHES.toLowerCase() !== "off";

    if (usarApproaches) {
      // encodeURIComponent no `;` (vira %3B): o proxy do Easypanel trata `;` cru
      // na query string como separador e corrompe o parâmetro (InvalidQuery), o
      // que silenciosamente cairia no fallback e tornaria o curb um no-op.
      const comCurb = await this.fetchOsrm(
        `${base}&approaches=${encodeURIComponent(OSRM_APPROACHES)}`,
      );
      if (comCurb.code === "Ok" && comCurb.routes?.[0]) {
        return comCurb.routes;
      }
      this.logger.warn(
        `OSRM curb sem rota (${comCurb.code}) — fallback sem approaches: ${coords}`,
      );
    }

    const data = await this.fetchOsrm(base);
    if (data.code !== "Ok" || !data.routes?.[0]) {
      throw new Error(`OSRM resposta inválida: ${data.code}`);
    }
    return data.routes;
  }

  /** GET no OSRM com timeout. Lança em erro de rede/HTTP; devolve o JSON cru
   * (inclusive code != Ok) pra quem chama decidir sobre fallback. */
  private async fetchOsrm(url: string): Promise<OsrmResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      return (await res.json()) as OsrmResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}
