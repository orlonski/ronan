import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarEmpresaInput, AtualizarEmpresaInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class EmpresasService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.empresaCliente.findMany({ orderBy: { nome: "asc" } });
  }

  findOne(id: string) {
    return this.prisma.empresaCliente.findUniqueOrThrow({ where: { id } });
  }

  async create(data: CriarEmpresaInput) {
    if (data.cnpj) {
      const exists = await this.prisma.empresaCliente.findUnique({ where: { cnpj: data.cnpj } });
      if (exists) throw new ConflictException("CNPJ já cadastrado");
    }
    return this.prisma.empresaCliente.create({
      data: data as Prisma.EmpresaClienteUncheckedCreateInput,
    });
  }

  async update(id: string, data: AtualizarEmpresaInput) {
    await this.ensureExists(id);
    return this.prisma.empresaCliente.update({
      where: { id },
      data: data as Prisma.EmpresaClienteUncheckedUpdateInput,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.empresaCliente.update({ where: { id }, data: { ativa: false } });
  }

  private async ensureExists(id: string) {
    const e = await this.prisma.empresaCliente.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Empresa não encontrada");
    return e;
  }
}
