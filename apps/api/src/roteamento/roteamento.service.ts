import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const CACHE_TTL_DIAS = 90;
const HTTP_TIMEOUT_MS = 5000;

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
    if (!opts.force && cached && this.cacheValido(cached.calculadoEm)) {
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
        },
        update: {
          km: new Prisma.Decimal(km),
          duracaoSegundos: Math.round(route.duration),
          geometria,
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
        },
        update: {
          km: new Prisma.Decimal(recomendada.km),
          duracaoSegundos: recomendada.duracaoSegundos,
          geometria: recomendada.geometria,
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

  private cacheValido(calculadoEm: Date): boolean {
    const idadeMs = Date.now() - calculadoEm.getTime();
    return idadeMs < CACHE_TTL_DIAS * 24 * 60 * 60 * 1000;
  }

  private async consultarOsrm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): Promise<{ distance: number; duration: number; geometry?: string }> {
    // overview=simplified retorna polyline encoded (precision 5) com algumas
    // dezenas de pontos — suficiente pra render no mapa. Sem custo extra de
    // requisição (mesma chamada que antes pegava só distance/duration).
    const url = `${this.osrmUrl}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=simplified&geometries=polyline`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = (await res.json()) as {
        code: string;
        routes?: { distance: number; duration: number; geometry?: string }[];
      };
      if (data.code !== "Ok" || !data.routes?.[0]) {
        throw new Error(`OSRM resposta inválida: ${data.code}`);
      }
      return data.routes[0];
    } finally {
      clearTimeout(timeout);
    }
  }

  private async consultarOsrmAlternativas(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): Promise<{ distance: number; duration: number; geometry?: string }[]> {
    // alternatives=3 pede até 3 rotas distintas. OSRM pode devolver menos (ou
    // só 1) quando não há alternativa razoável. routes[0] = a recomendada.
    const url = `${this.osrmUrl}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=simplified&geometries=polyline&alternatives=3`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = (await res.json()) as {
        code: string;
        routes?: { distance: number; duration: number; geometry?: string }[];
      };
      if (data.code !== "Ok" || !data.routes?.[0]) {
        throw new Error(`OSRM resposta inválida: ${data.code}`);
      }
      return data.routes;
    } finally {
      clearTimeout(timeout);
    }
  }
}
