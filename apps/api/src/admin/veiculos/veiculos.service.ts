import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CriarVeiculoInput, AtualizarVeiculoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class VeiculosService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.veiculo.findMany({ orderBy: { placa: "asc" } });
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
    return this.prisma.veiculo.update({ where: { id }, data: { ativo: false } });
  }

  private async ensureExists(id: string) {
    const v = await this.prisma.veiculo.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("Veículo não encontrado");
    return v;
  }
}
