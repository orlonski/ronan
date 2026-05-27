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
}
