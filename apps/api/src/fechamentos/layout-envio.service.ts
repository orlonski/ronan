import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type ColunaLayout = {
  campo: string; // ex: "data", "placa", "ticket", "valor_total"
  header: string; // texto que aparece no XLSX
  ordem: number;
  formato?: "date_br" | "date_iso" | "decimal_br" | "currency_br" | "text";
};

export type ConfigLayout = {
  incluiCabecalhoEmpresa?: boolean;
  formatoData?: "DD/MM/YYYY" | "YYYY-MM-DD" | "DD/MM/YY";
  separadorDecimal?: "vírgula" | "ponto";
  agruparPor?: "data" | "cliente" | "placa" | "nenhum";
  totaisRodape?: boolean;
};

@Injectable()
export class LayoutEnvioService {
  constructor(private readonly prisma: PrismaService) {}

  async list(empresaId: string) {
    return this.prisma.layoutEnvio.findMany({
      where: { empresaId },
      orderBy: [{ padrao: "desc" }, { criadoEm: "asc" }],
    });
  }

  async detalhe(id: string) {
    const layout = await this.prisma.layoutEnvio.findUnique({ where: { id } });
    if (!layout) throw new NotFoundException("Layout não encontrado");
    return layout;
  }

  async criar(input: {
    usuarioId: string;
    empresaId: string;
    nome: string;
    colunas: ColunaLayout[];
    config?: ConfigLayout;
    padrao?: boolean;
  }) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: input.empresaId },
    });
    if (!empresa) throw new NotFoundException("Empresa não encontrada");
    if (input.colunas.length === 0) {
      throw new BadRequestException("Layout precisa de pelo menos uma coluna");
    }

    if (input.padrao) {
      await this.prisma.layoutEnvio.updateMany({
        where: { empresaId: input.empresaId, padrao: true },
        data: { padrao: false },
      });
    }

    return this.prisma.layoutEnvio.create({
      data: {
        empresaId: input.empresaId,
        nome: input.nome,
        colunas: input.colunas as unknown as Prisma.InputJsonValue,
        config: (input.config ?? {}) as unknown as Prisma.InputJsonValue,
        padrao: input.padrao ?? false,
        criadoPorId: input.usuarioId,
      },
    });
  }

  async atualizar(input: {
    id: string;
    nome?: string;
    colunas?: ColunaLayout[];
    config?: ConfigLayout;
    padrao?: boolean;
  }) {
    const layout = await this.prisma.layoutEnvio.findUnique({ where: { id: input.id } });
    if (!layout) throw new NotFoundException("Layout não encontrado");

    if (input.padrao) {
      await this.prisma.layoutEnvio.updateMany({
        where: { empresaId: layout.empresaId, padrao: true, NOT: { id: input.id } },
        data: { padrao: false },
      });
    }

    return this.prisma.layoutEnvio.update({
      where: { id: input.id },
      data: {
        nome: input.nome,
        colunas: input.colunas
          ? (input.colunas as unknown as Prisma.InputJsonValue)
          : undefined,
        config: input.config
          ? (input.config as unknown as Prisma.InputJsonValue)
          : undefined,
        padrao: input.padrao,
      },
    });
  }

  async remover(id: string) {
    await this.prisma.layoutEnvio.delete({ where: { id } });
    return { ok: true };
  }
}
