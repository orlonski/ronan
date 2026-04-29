import { Injectable } from "@nestjs/common";
import type { CriarPedagioInput } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PedagiosMotoristaService {
  constructor(private readonly prisma: PrismaService) {}

  list(motoristaId: string) {
    return this.prisma.pedagio.findMany({
      where: { motoristaId },
      include: {
        veiculo: { select: { id: true, placa: true } },
        viagem: { select: { id: true, ticket: true, data: true } },
      },
      orderBy: { data: "desc" },
      take: 100,
    });
  }

  async create(motoristaId: string, input: CriarPedagioInput) {
    const exists = await this.prisma.pedagio.findUnique({ where: { clientId: input.clientId } });
    if (exists) {
      return this.prisma.pedagio.findUnique({
        where: { clientId: input.clientId },
        include: {
          veiculo: { select: { id: true, placa: true } },
          viagem: { select: { id: true, ticket: true, data: true } },
        },
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
      include: {
        veiculo: { select: { id: true, placa: true } },
        viagem: { select: { id: true, ticket: true, data: true } },
      },
    });
  }
}
