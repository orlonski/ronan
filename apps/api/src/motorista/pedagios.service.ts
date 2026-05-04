import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarPedagioInput } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { mesRange } from "./viagens.service";

const PEDAGIO_INCLUDE = {
  veiculo: { select: { id: true, placa: true } },
  viagem: { select: { id: true, ticket: true, data: true } },
} satisfies Prisma.PedagioInclude;

@Injectable()
export class PedagiosMotoristaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    motoristaId: string,
    filtros: { mes?: string; cursor?: string; limit: number },
  ) {
    const where: Prisma.PedagioWhereInput = { motoristaId };
    if (filtros.mes) {
      const { inicio, fim } = mesRange(filtros.mes);
      where.data = { gte: inicio, lt: fim };
    }

    const itens = await this.prisma.pedagio.findMany({
      where,
      include: PEDAGIO_INCLUDE,
      orderBy: [{ data: "desc" }, { id: "desc" }],
      take: filtros.limit + 1,
      ...(filtros.cursor
        ? { cursor: { id: filtros.cursor }, skip: 1 }
        : {}),
    });

    const hasMore = itens.length > filtros.limit;
    const pageItens = hasMore ? itens.slice(0, filtros.limit) : itens;
    const nextCursor = hasMore ? pageItens[pageItens.length - 1].id : null;

    return { itens: pageItens, nextCursor };
  }

  async delete(motoristaId: string, pedagioId: string): Promise<void> {
    const pedagio = await this.prisma.pedagio.findUnique({
      where: { id: pedagioId },
      select: { id: true, motoristaId: true },
    });
    if (!pedagio) throw new NotFoundException("Pedágio não encontrado.");
    if (pedagio.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esse pedágio não é seu.");
    }
    await this.prisma.pedagio.delete({ where: { id: pedagioId } });
  }

  async create(motoristaId: string, input: CriarPedagioInput) {
    const exists = await this.prisma.pedagio.findUnique({
      where: { clientId: input.clientId },
    });
    if (exists) {
      return this.prisma.pedagio.findUnique({
        where: { clientId: input.clientId },
        include: PEDAGIO_INCLUDE,
      });
    }
    return this.prisma.pedagio.create({
      data: {
        clientId: input.clientId,
        motoristaId,
        veiculoId: input.veiculoId,
        data: input.data,
        pracaPedagio: input.pracaPedagio,
        valor: input.valor,
        viagemId: input.viagemId,
      },
      include: PEDAGIO_INCLUDE,
    });
  }
}
