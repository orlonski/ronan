import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListParams = PaginationQuery & {
  uf?: string;
  ativo?: "true" | "false";
};

export type CriarInput = {
  nome: string;
  concessionaria?: string | null;
  rodovia?: string | null;
  cidade?: string | null;
  uf?: string | null;
  lat: number;
  lng: number;
  valorBase?: number | null;
};

export type AtualizarInput = Partial<CriarInput> & { ativo?: boolean };

@Injectable()
export class PedagiosRodoviaService {
  private readonly log = new Logger(PedagiosRodoviaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListParams) {
    const where: Prisma.PedagioRodoviaWhereInput = {};
    if (params.uf) where.uf = params.uf.toUpperCase();
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.pedagioRodovia, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["nome", "concessionaria", "rodovia", "cidade"],
      sortable: { nome: "nome", uf: "uf", criadoEm: "criadoEm" },
      defaultSort: { field: "nome", order: "asc" },
    });
  }

  async detalhe(id: string) {
    const p = await this.prisma.pedagioRodovia.findUnique({ where: { id } });
    if (!p) throw new NotFoundException("Pedágio não encontrado");
    return p;
  }

  criar(input: CriarInput) {
    return this.prisma.pedagioRodovia.create({
      data: {
        nome: input.nome,
        concessionaria: input.concessionaria ?? null,
        rodovia: input.rodovia ?? null,
        cidade: input.cidade ?? null,
        uf: input.uf?.toUpperCase() ?? null,
        lat: input.lat,
        lng: input.lng,
        valorBase: input.valorBase ?? null,
        fonte: "manual",
      },
    });
  }

  async atualizar(id: string, input: AtualizarInput) {
    await this.detalhe(id);
    return this.prisma.pedagioRodovia.update({
      where: { id },
      data: {
        ...input,
        uf: input.uf?.toUpperCase() ?? input.uf,
      },
    });
  }

  async excluir(id: string) {
    await this.detalhe(id);
    await this.prisma.pedagioRodovia.delete({ where: { id } });
  }

  /**
   * Importa pedágios do OpenStreetMap via Overpass API. Busca todas as
   * features `barrier=toll_booth` no bbox do Brasil. Idempotente por
   * `osmId`: re-importação atualiza os existentes (nome, lat/lng podem
   * mudar) e cria os novos. Não apaga os que sumiram do OSM (pode ser
   * desativação humana ou bug temporário do dado upstream).
   */
  async importarOSM(): Promise<{ criados: number; atualizados: number }> {
    // Query usa área pré-definida do Brasil (relation/admin_level=2) — mais
    // rápido que bbox cobrindo oceano. timeout interno generoso (90s);
    // AbortController externo evita ficar pendurado se o servidor Overpass
    // travar. Headers identificam a app (boas práticas Overpass).
    const query = `
[out:json][timeout:90];
area["ISO3166-1"="BR"][admin_level=2]->.br;
(
  node["barrier"="toll_booth"](area.br);
  node["barrier"="toll_gantry"](area.br);
);
out body;
`;
    const url = "https://overpass-api.de/api/interpreter";
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 110_000);
    let json: {
      elements: Array<{
        id: number;
        lat: number;
        lon: number;
        tags?: Record<string, string>;
      }>;
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ronan-schaba/1.0 (contact: orlonski@icloud.com)",
        },
        signal: ac.signal,
      });
      if (!res.ok) {
        const corpo = await res.text().catch(() => "");
        throw new Error(
          `Overpass API ${res.status} ${res.statusText}: ${corpo.slice(0, 300)}`,
        );
      }
      json = (await res.json()) as typeof json;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error(
          "Overpass API não respondeu em 110s. Tente de novo em alguns minutos (servidor público costuma sobrecarregar de manhã).",
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    this.log.log(`Overpass retornou ${json.elements.length} elementos`);

    let criados = 0;
    let atualizados = 0;
    let pulados = 0;
    for (const el of json.elements) {
      if (typeof el.lat !== "number" || typeof el.lon !== "number") continue;
      const osmId = String(el.id);
      const tags = el.tags ?? {};
      const nome =
        tags["name"] ??
        tags["operator"] ??
        `Pedágio ${tags["ref"] ?? osmId}`;
      try {
        const res = await this.prisma.pedagioRodovia.upsert({
          where: { osmId },
          create: {
            nome: nome.slice(0, 200),
            concessionaria: tags["operator"] ?? null,
            rodovia: tags["ref"] ?? null,
            uf: null,
            cidade: null,
            lat: el.lat,
            lng: el.lon,
            fonte: "osm",
            osmId,
          },
          update: { nome: nome.slice(0, 200), lat: el.lat, lng: el.lon },
          select: { criadoEm: true, alteradoEm: true },
        });
        if (res.criadoEm.getTime() === res.alteradoEm.getTime()) {
          criados++;
        } else {
          atualizados++;
        }
      } catch (err) {
        pulados++;
        this.log.warn(`Falha ao upsert pedágio osmId=${osmId}: ${(err as Error).message}`);
      }
    }
    this.log.log(
      `Importação OSM: ${criados} criados, ${atualizados} atualizados, ${pulados} pulados`,
    );
    return { criados, atualizados };
  }

  /**
   * Lista pedágios ativos cujo lat/lng cai num envelope ao redor da rota.
   * Pré-filtro grosso por bounding box pra evitar haversine em todos os
   * pedágios do BR. Caller faz a checagem fina ponto-segmento.
   */
  async listarNoEnvelope(args: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }) {
    return this.prisma.pedagioRodovia.findMany({
      where: {
        ativo: true,
        lat: { gte: args.minLat, lte: args.maxLat },
        lng: { gte: args.minLng, lte: args.maxLng },
      },
      select: {
        id: true,
        nome: true,
        concessionaria: true,
        rodovia: true,
        lat: true,
        lng: true,
        valorBase: true,
      },
    });
  }
}
