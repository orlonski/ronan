import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, TipoCombustivel } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";

@Injectable()
export class AbastecimentosAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(filtros: {
    motoristaId?: string;
    veiculoId?: string;
    tipo?: TipoCombustivel;
    de?: string;
    ate?: string;
    take?: number;
  }) {
    const where: Prisma.AbastecimentoWhereInput = {};
    if (filtros.motoristaId) where.motoristaId = filtros.motoristaId;
    if (filtros.veiculoId) where.veiculoId = filtros.veiculoId;
    if (filtros.tipo) where.tipo = filtros.tipo;
    if (filtros.de || filtros.ate) {
      where.data = {};
      if (filtros.de) where.data.gte = new Date(filtros.de);
      if (filtros.ate) where.data.lte = new Date(filtros.ate);
    }

    const [itens, totais] = await Promise.all([
      this.prisma.abastecimento.findMany({
        where,
        include: {
          veiculo: { select: { id: true, placa: true, modelo: true } },
          motorista: { select: { id: true, nome: true } },
          _count: { select: { fotos: true } },
        },
        orderBy: { data: "desc" },
        take: filtros.take ?? 200,
      }),
      this.prisma.abastecimento.aggregate({
        where,
        _count: { _all: true },
        _sum: { litros: true, valorTotal: true },
      }),
    ]);

    return {
      itens,
      totais: {
        count: totais._count._all,
        litros: (totais._sum.litros ?? "0").toString(),
        valor: (totais._sum.valorTotal ?? "0").toString(),
      },
    };
  }

  async detalhe(id: string) {
    const a = await this.prisma.abastecimento.findUnique({
      where: { id },
      include: {
        veiculo: true,
        motorista: { select: { id: true, nome: true, cpf: true } },
        fotos: true,
      },
    });
    if (!a) throw new NotFoundException("Abastecimento não encontrado");
    return a;
  }

  /**
   * Hard delete do abastecimento. Bloqueado se há linha de fechamento usando
   * abastecimentoMatchId. AbastecimentoFoto sai cascade.
   */
  async excluir(id: string) {
    const a = await this.prisma.abastecimento.findUnique({
      where: { id },
      select: { id: true, fotos: { select: { storageKey: true } } },
    });
    if (!a) throw new NotFoundException("Abastecimento não encontrado");

    const linhasMatch = await this.prisma.fechamentoLinha.count({
      where: { abastecimentoMatchId: id },
    });
    if (linhasMatch > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${linhasMatch} linha${linhasMatch === 1 ? "" : "s"} de fechamento.`,
      );
    }

    await Promise.all(
      a.fotos.map((f) => this.uploads.removeObject(f.storageKey)),
    );
    await this.prisma.abastecimento.delete({ where: { id } });
    return { ok: true };
  }

  async fotoBuffer(abastecimentoId: string, fotoId: string) {
    const foto = await this.prisma.abastecimentoFoto.findFirst({
      where: { id: fotoId, abastecimentoId },
      select: { storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    const buffer = await this.uploads.getObjectBuffer(foto.storageKey);
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    return { buffer, contentType };
  }
}
