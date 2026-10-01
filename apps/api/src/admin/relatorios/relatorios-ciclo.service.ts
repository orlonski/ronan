import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { comEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { resumirCiclo } from "../../common/ciclo-carga";

/**
 * Relatório "Ciclo da carga": quanto tempo o caminhão fica em cada pedreira,
 * em cada trajeto e em cada obra. A conta mora em common/ciclo-carga.ts; só a
 * viagem GUIADA tem os marcos (a lançada de uma vez só não tem horário de fase).
 */
@Injectable()
export class RelatoriosCicloService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo(q: { de: string; ate: string }, escopo: EscopoAdmin) {
    const viagens = await this.prisma.viagem.findMany({
      where: comEscopo(
        {
          iniciadaGuiada: true,
          data: { gte: new Date(`${q.de}T00:00:00Z`), lte: new Date(`${q.ate}T00:00:00Z`) },
          status: { not: "RASCUNHO_OFFLINE" },
        },
        escopo,
      ) as Prisma.ViagemWhereInput,
      select: {
        id: true,
        localCarga: { select: { id: true, nome: true } },
        localDescarga: { select: { id: true, nome: true } },
        eventosViagem: {
          select: {
            tipoSlug: true,
            ocorridoEm: true,
            tipoEvento: { select: { ehCarga: true, ehDescarga: true } },
          },
        },
      },
    });
    return {
      periodo: q,
      ...resumirCiclo(
        viagens.map((v) => ({
          id: v.id,
          localCarga: v.localCarga,
          localDescarga: v.localDescarga,
          eventos: v.eventosViagem.map((e) => ({
            slug: e.tipoSlug,
            ehCarga: e.tipoEvento.ehCarga,
            ehDescarga: e.tipoEvento.ehDescarga,
            ocorridoEm: e.ocorridoEm,
          })),
        })),
      ),
    };
  }
}
