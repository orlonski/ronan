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
    const [obras, fechamentos, layouts, envios] = await Promise.all([
      this.prisma.obra.count({ where: { empresaClienteId: id } }),
      this.prisma.fechamento.count({ where: { empresaClienteId: id } }),
      this.prisma.layoutEnvio.count({ where: { empresaId: id } }),
      this.prisma.envioFechamento.count({ where: { empresaClienteId: id } }),
    ]);
    const partes: string[] = [];
    if (obras > 0) partes.push(`${obras} obra${obras === 1 ? "" : "s"}`);
    if (fechamentos > 0)
      partes.push(`${fechamentos} fechamento${fechamentos === 1 ? "" : "s"}`);
    if (layouts > 0) partes.push(`${layouts} layout${layouts === 1 ? "" : "s"} de envio`);
    if (envios > 0) partes.push(`${envios} envio${envios === 1 ? "" : "s"}`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    // LayoutImportBloco sai cascade via schema
    await this.prisma.empresaCliente.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const e = await this.prisma.empresaCliente.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Empresa não encontrada");
    return e;
  }
}
