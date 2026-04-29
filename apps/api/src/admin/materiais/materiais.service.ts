import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import type { CriarMaterialInput, AtualizarMaterialInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class MateriaisService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.material.findMany({ orderBy: { nome: "asc" } });
  }

  async create(data: CriarMaterialInput) {
    const exists = await this.prisma.material.findUnique({ where: { nome: data.nome } });
    if (exists) throw new ConflictException("Material já cadastrado");
    return this.prisma.material.create({ data });
  }

  async update(id: string, data: AtualizarMaterialInput) {
    await this.ensureExists(id);
    return this.prisma.material.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.material.update({ where: { id }, data: { ativo: false } });
  }

  private async ensureExists(id: string) {
    const m = await this.prisma.material.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Material não encontrado");
    return m;
  }
}
