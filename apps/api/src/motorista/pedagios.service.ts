import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarPedagioInput } from "@ronan/shared-types";
import { garantirCadastro } from "../common/item-inexistente";
import { resolverTransportadora } from "../common/transportadora";
import { LancamentosResgatadosService } from "../lancamentos-resgatados/lancamentos-resgatados.service";
import { PrismaService } from "../prisma/prisma.service";
import { mesRange } from "./viagens.service";

const PEDAGIO_INCLUDE = {
  veiculo: { select: { id: true, placa: true } },
  viagem: { select: { id: true, ticket: true, data: true } },
} satisfies Prisma.PedagioInclude;

@Injectable()
export class PedagiosMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resgates: LancamentosResgatadosService,
  ) {}

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
    // Valida os cadastros antes de gravar: a placa pode ter sido removida do
    // cadastro do motorista enquanto o pedágio esperava sinal no celular, e a
    // viagem vinculada pode ter sido apagada no painel. Sem isso vira FK
    // violation com mensagem genérica — e pedágio ainda não tem tela de edição,
    // então o motorista fica sem saída nenhuma a não ser descartar.
    await garantirCadastro(
      () =>
        this.prisma.veiculo.findUnique({
          where: { id: input.veiculoId },
          select: { id: true },
        }),
      "veiculoId",
    );
    if (input.viagemId) {
      await garantirCadastro(
        () =>
          this.prisma.viagem.findUnique({
            where: { id: input.viagemId },
            select: { id: true },
          }),
        "viagemId",
      );
    }

    // Frota dona do lançamento, carimbada na criação (ver common/transportadora.ts).
    const transportadoraId = await resolverTransportadora(
      this.prisma,
      motoristaId,
      input.veiculoId,
    );
    void this.resgates.marcarQueSubiu(input.clientId);
    return this.prisma.pedagio.create({
      data: {
        clientId: input.clientId,
        motoristaId,
        veiculoId: input.veiculoId,
        transportadoraId,
        data: input.data,
        pracaPedagio: input.pracaPedagio,
        valor: input.valor,
        viagemId: input.viagemId,
      },
      include: PEDAGIO_INCLUDE,
    });
  }
}
