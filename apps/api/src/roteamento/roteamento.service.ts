import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { codificarPolyline, decodificarPolyline } from "./polyline";

const CACHE_TTL_DIAS = 90;
// Timeout por-tentativa. A cascata curb→sem-curb pode fazer até 2 chamadas; com
// 3.5s cada o pior caso (~7s) ainda cabe no lançamento. Na prática a 1ª resolve.
const HTTP_TIMEOUT_MS = 3500;

// Versão do roteador. Bumpar sempre que a forma de calcular a rota mudar (ex.:
// desligar approaches=curb) invalida o RotaCache antigo de forma lazy: entradas
// de versão diferente viram stale e são recomputadas no próximo acesso.
// v4: rota DIRETA (mais curta) é o padrão — o roteador não força mais o retorno
// de pista dupla (removemos a escolha "cheguei direto / precisei voltar").
const ROUTER_VERSION = 4;

// approaches=curb;curb forçava o roteador a chegar/sair no lado correto da via
// (mão-direita no Brasil), contando o retorno quando o ponto caía na pista de
// sentido contrário. Removemos a escolha manual de retorno: o padrão agora é a
// rota DIRETA (sem curb), estilo mapa comum. Se algum dia quiser reativar o
// curb, basta OSRM_APPROACHES="curb;curb" no ambiente (e bumpar ROUTER_VERSION).
const OSRM_APPROACHES = (process.env.OSRM_APPROACHES ?? "off").trim();

// Quantas alternativas pedir ao Valhalla ALÉM da principal. O servidor corta
// pelo `service_limits.max_alternates` (2 no default da imagem) — pedir mais que
// isso não é erro, só volta menos.
const VALHALLA_ALTERNATES = 2;

// Teto de desvio de uma alternativa sobre a MAIS CURTA do par. O Valhalla não
// tem pudor: em par de 28 km ele chega a oferecer um caminho de 52 (+84%), e
// medindo 39 alternativas de pares reais da frota o excesso se agrupa até ~30% e
// depois vira cauda solta (+30% a +74%). Como agora o motorista é obrigado a
// escolher e o que ele escolhe é o que se fatura, deixar essa cauda na tela é
// oferecer prejuízo de bandeja — e nenhum mapa de rua mostraria aquilo como
// "opção". Acima do teto a rota é descartada da lista.
const VALHALLA_DESVIO_MAX = 1.3;

// Diferença mínima (km) entre a variante COM retorno (curb) e SEM retorno pra
// valer a pena perguntar ao motorista. Abaixo disso, o ponto já está do lado
// certo (sem retorno real) → devolve 1 opção só, sem escolha/fricção.
const LIMIAR_DEDUP_KM = 0.3;

type OsrmRoute = { distance: number; duration: number; geometry?: string };
type OsrmResponse = { code: string; routes?: OsrmRoute[] };

type ValhallaTrip = {
  summary?: { length: number; time: number };
  legs?: { shape?: string }[];
};
type ValhallaRouteResponse = { trip?: ValhallaTrip; alternates?: { trip?: ValhallaTrip }[] };
/** Trip que já passou pelo filtro de resumo — só essa vira RotaOption. */
type ValhallaTripComResumo = ValhallaTrip & { summary: { length: number; time: number } };

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
  // Mesmo servidor da navegação ao vivo (navegacao.service.ts). Aqui ele serve a
  // LISTA de estradas que o motorista escolhe; o km continua saindo da opção que
  // ele apontar.
  private readonly valhallaUrl = process.env.VALHALLA_URL ?? "";

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
   * Calcula ATÉ 3 rotas alternativas carga→descarga, pra o motorista apontar
   * qual estrada pegou.
   *
   * Ordem: **Valhalla primeiro** (é ele que enxerga os caminhos reais — ver
   * `consultarValhallaAlternativas`), OSRM como rede de segurança. Só adota o
   * Valhalla quando ele traz ESCOLHA de fato (2+ rotas); com uma rota só o OSRM
   * entrega o mesmo e mantém o km na régua do resto do sistema.
   *
   * Online-only: não lê cache antes (queremos as alternativas frescas). No
   * caminho OSRM, atualiza o RotaCache com routes[0] pra manter o default
   * coerente com o que `calcularKm` devolveria — o caminho Valhalla **não**
   * escreve no cache, que é convenção OSRM (mesma origem de km, mesma polyline).
   * NÃO cacheia a lista inteira.
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

    // 1ª tentativa: Valhalla. É ele que acha os caminhos que o motorista
    // reconhece — o OSRM devolve 1 rota em par onde existem 3 de verdade.
    // Só vale a pena quando trouxe ESCOLHA (2+); com 1 rota o OSRM serve igual e
    // mantém o km na mesma régua do resto do sistema (cache, reprocessamento,
    // pedágio na rota). Falha aqui nunca derruba o lançamento: cai pro OSRM.
    try {
      const doValhalla = await this.consultarValhallaAlternativas(
        origem.lat,
        origem.lng,
        destino.lat,
        destino.lng,
      );
      if (doValhalla.length > 1) return { rotas: doValhalla };
    } catch (err) {
      this.logger.warn(
        `Valhalla alternativas falhou ${localOrigemId}->${localDestinoId}: ${(err as Error).message}`,
      );
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

  /**
   * Geometria cacheada do par, só quando confiável: versão atual do roteador e
   * dentro do TTL — os mesmos critérios de `calcularKm`. Diferente dele, NUNCA
   * chama OSRM: quem consome roda por linha de listagem e não pode pagar rede.
   * `null` = "não sei" (sem cache, stale ou de roteador antigo); o chamador não
   * pode ler isso como "a rota não tem nada".
   */
  async geometriaCacheada(
    localOrigemId: string,
    localDestinoId: string,
  ): Promise<string | null> {
    if (localOrigemId === localDestinoId) return null;
    const cached = await this.prisma.rotaCache.findUnique({
      where: { localOrigemId_localDestinoId: { localOrigemId, localDestinoId } },
      select: { geometria: true, versaoRoteador: true, calculadoEm: true },
    });
    if (!cached?.geometria) return null;
    if (cached.versaoRoteador !== ROUTER_VERSION) return null;
    if (!this.cacheValido(cached.calculadoEm)) return null;
    return cached.geometria;
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
   * Alternativas pelo VALHALLA — o motor que realmente acha os caminhos.
   *
   * O OSRM é severo demais pra esse uso: ele descarta alternativa que
   * compartilhe muito trecho com a principal, e esses limites são constantes
   * compiladas no C++ (`alternative_path_mld.cpp`), sem parâmetro HTTP pra
   * afrouxar. Resultado prático: em par onde o Google mostra 3 caminhos, o OSRM
   * devolve 1 — e o motorista era cobrado por uma escolha que a tela nunca
   * ofereceu. O Valhalla, no mesmo par, devolve os 3.
   *
   * `costing: "truck"` é o mesmo perfil da navegação ao vivo
   * (`navegacao.service.ts`), então a estrada oferecida aqui é a mesma que o guia
   * de voz vai conduzir depois.
   *
   * `alternates` é limitado pelo `service_limits.max_alternates` do servidor
   * (2 no default da imagem, ou seja 3 rotas no total contando a principal). Se
   * o servidor estiver com 0, isto devolve 1 rota e o chamador cai no OSRM.
   */
  private async consultarValhallaAlternativas(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): Promise<RotaOption[]> {
    if (!this.valhallaUrl) return [];

    const body = {
      locations: [
        { lat: lat1, lon: lng1 },
        { lat: lat2, lon: lng2 },
      ],
      costing: "truck",
      alternates: VALHALLA_ALTERNATES,
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
      const data = (await res.json()) as ValhallaRouteResponse;

      const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)].filter(
        (t): t is ValhallaTripComResumo => !!t?.summary,
      );

      const comGeometria = trips
        .map((trip, idx) => {
          // O `shape` vem por PERNA e em precisão 6; o sistema inteiro fala
          // polyline 5 (ver roteamento/polyline.ts). Emenda as pernas e converte
          // aqui, na fronteira — depois daqui ninguém mais precisa saber disso.
          const pontos = (trip.legs ?? []).flatMap((leg) =>
            leg.shape ? decodificarPolyline(leg.shape, 6) : [],
          );
          return {
            kmNum: trip.summary.length,
            km: trip.summary.length.toFixed(2),
            duracaoSegundos: Math.round(trip.summary.time),
            geometria: pontos.length >= 2 ? codificarPolyline(pontos, 5) : null,
            principal: idx === 0,
          };
        })
        .filter((r) => r.geometria !== null);

      if (comGeometria.length === 0) return [];

      // Corta a cauda de desvios absurdos (ver VALHALLA_DESVIO_MAX).
      const maisCurta = Math.min(...comGeometria.map((r) => r.kmNum));
      const sobreviventes = comGeometria.filter(
        (r) => r.kmNum <= maisCurta * VALHALLA_DESVIO_MAX,
      );

      // A "sugerida" é a principal do Valhalla — mas ela mesma pode ter caído no
      // corte (a principal é a mais RÁPIDA, e às vezes a mais rápida é um desvio
      // longo demais). Nesse caso a primeira que sobrou assume, pra lista nunca
      // ficar sem referência.
      const temPrincipal = sobreviventes.some((r) => r.principal);
      return sobreviventes.map((r, idx) => ({
        km: r.km,
        duracaoSegundos: r.duracaoSegundos,
        geometria: r.geometria,
        recomendada: temPrincipal ? r.principal : idx === 0,
      }));
    } finally {
      clearTimeout(timeout);
    }
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
