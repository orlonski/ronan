import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarVeiculoInput, AtualizarVeiculoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListVeiculosParams = PaginationQuery & { ativo?: "true" | "false" };

@Injectable()
export class VeiculosService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListVeiculosParams) {
    const where: Prisma.VeiculoWhereInput = {};
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.veiculo, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["placa", "modelo"],
      sortable: { placa: "placa", modelo: "modelo", criadoEm: "criadoEm", ativo: "ativo" },
      defaultSort: { field: "placa", order: "asc" },
    });
  }

  async create(data: CriarVeiculoInput) {
    const exists = await this.prisma.veiculo.findUnique({ where: { placa: data.placa } });
    if (exists) throw new ConflictException("Placa já cadastrada");
    return this.prisma.veiculo.create({ data });
  }

  async update(id: string, data: AtualizarVeiculoInput) {
    await this.ensureExists(id);
    return this.prisma.veiculo.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [viagens, pedagios, abastecimentos, motoristas] = await Promise.all([
      this.prisma.viagem.count({ where: { veiculoId: id } }),
      this.prisma.pedagio.count({ where: { veiculoId: id } }),
      this.prisma.abastecimento.count({ where: { veiculoId: id } }),
      this.prisma.motorista.count({ where: { veiculoDefaultId: id } }),
    ]);
    const partes: string[] = [];
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "s"}`);
    if (pedagios > 0) partes.push(`${pedagios} pedágio${pedagios === 1 ? "" : "s"}`);
    if (abastecimentos > 0)
      partes.push(`${abastecimentos} abastecimento${abastecimentos === 1 ? "" : "s"}`);
    if (motoristas > 0)
      partes.push(`${motoristas} motorista${motoristas === 1 ? "" : "s"} com este como veículo padrão`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    await this.prisma.veiculo.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const v = await this.prisma.veiculo.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("Veículo não encontrado");
    return v;
  }
}
