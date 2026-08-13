import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PapelEmpresa, Prisma } from "@prisma/client";
import type { CriarEmpresaInput, AtualizarEmpresaInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListEmpresasParams = PaginationQuery & {
  ativa?: "true" | "false";
  papel?: PapelEmpresa;
};

@Injectable()
export class EmpresasService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListEmpresasParams) {
    const where: Prisma.EmpresaWhereInput = {};
    if (params.ativa === "true") where.ativa = true;
    if (params.ativa === "false") where.ativa = false;
    if (params.papel) where.papel = params.papel;
    return paginate(this.prisma.empresa, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: não há o que filtrar por transportadora. O
      // isolamento entre EMPRESAS aqui é da trava de conta; o recorte por frota
      // fica com a matriz de papéis (não existe guard de escopo — ver escopo.ts).
      escopo: SEM_ESCOPO,
      searchFields: ["nome", "cnpj", "contato"],
      sortable: { nome: "nome", cnpj: "cnpj", papel: "papel", ativa: "ativa", criadoEm: "criadoEm" },
      defaultSort: { field: "nome", order: "asc" },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.empresa.findUniqueOrThrow({
      where: { id },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  async create(data: CriarEmpresaInput, usuarioId: string) {
    if (data.cnpj) {
      const exists = await this.prisma.empresa.findFirst({ where: { cnpj: data.cnpj } });
      if (exists) throw new ConflictException("CNPJ já cadastrado");
    }
    return this.prisma.empresa.create({
      data: { ...data, criadoPorId: usuarioId } as Prisma.EmpresaUncheckedCreateInput,
    });
  }

  async update(id: string, data: AtualizarEmpresaInput) {
    await this.ensureExists(id);
    return this.prisma.empresa.update({
      where: { id },
      data: data as Prisma.EmpresaUncheckedUpdateInput,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [clientes, fechamentos, layouts, envios] = await Promise.all([
      this.prisma.cliente.count({ where: { empresaId: id } }),
      this.prisma.fechamento.count({ where: { empresaId: id } }),
      this.prisma.layoutEnvio.count({ where: { empresaId: id } }),
      this.prisma.envioFechamento.count({ where: { empresaId: id } }),
    ]);
    const partes: string[] = [];
    if (clientes > 0) partes.push(`${clientes} cliente${clientes === 1 ? "" : "s"}`);
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
    await this.prisma.empresa.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const e = await this.prisma.empresa.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Empresa não encontrada");
    return e;
  }
}
