import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

const SINGLETON_ID = "default";
const HISTORICO_LIMIT = 100;

export type AtualizarIaConfigInput = {
  confidenceMinimo?: number;
  janelaDias?: number;
};

@Injectable()
export class IaConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garante singleton e retorna. */
  async get() {
    return this.prisma.configuracaoIa.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  }

  async update(input: AtualizarIaConfigInput, userId: string) {
    return this.prisma.configuracaoIa.upsert({
      where: { id: SINGLETON_ID },
      update: { ...input, alteradoPorId: userId },
      create: { id: SINGLETON_ID, ...input, alteradoPorId: userId },
    });
  }

  /**
   * Últimas N sugestões da IA agregadas por confidence — alimenta o
   * simulador interativo no front (histograma + texto live).
   * Apenas o campo `confidence` é exposto pra evitar vazar info de viagens.
   */
  async historicoSugestoes(): Promise<{ confidence: number }[]> {
    const linhas = await this.prisma.fechamentoLinha.findMany({
      where: { sugestaoIa: { not: null as unknown as undefined } },
      select: { sugestaoIa: true },
      orderBy: { id: "desc" },
      take: HISTORICO_LIMIT,
    });

    const out: { confidence: number }[] = [];
    for (const l of linhas) {
      const s = l.sugestaoIa as { confidence?: number } | null;
      if (s && typeof s.confidence === "number" && Number.isFinite(s.confidence)) {
        out.push({ confidence: s.confidence });
      }
    }
    return out;
  }
}
