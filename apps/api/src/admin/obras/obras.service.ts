import { Injectable, NotFoundException } from "@nestjs/common";
import type { CriarObraInput, AtualizarObraInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class ObrasService {
  constructor(private readonly prisma: PrismaService) {}

  list(empresaClienteId?: string) {
    return this.prisma.obra.findMany({
      where: empresaClienteId ? { empresaClienteId } : undefined,
      include: { empresaCliente: { select: { id: true, nome: true } } },
      orderBy: { nome: "asc" },
    });
  }

  async create(data: CriarObraInput) {
    await this.ensureEmpresa(data.empresaClienteId);
    return this.prisma.obra.create({ data });
  }

  async update(id: string, data: AtualizarObraInput) {
    await this.ensureExists(id);
    if (data.empresaClienteId) await this.ensureEmpresa(data.empresaClienteId);
    return this.prisma.obra.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.obra.update({ where: { id }, data: { ativa: false } });
  }

  private async ensureExists(id: string) {
    const o = await this.prisma.obra.findUnique({ where: { id } });
    if (!o) throw new NotFoundException("Obra não encontrada");
    return o;
  }

  private async ensureEmpresa(id: string) {
    const e = await this.prisma.empresaCliente.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Empresa-cliente não encontrada");
    return e;
  }
}
