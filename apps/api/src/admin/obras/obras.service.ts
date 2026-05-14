import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarObraInput, AtualizarObraInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListObrasParams = PaginationQuery & {
  empresaClienteId?: string;
  ativa?: "true" | "false";
};

@Injectable()
export class ObrasService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListObrasParams) {
    const where: Prisma.ObraWhereInput = {};
    if (params.empresaClienteId) where.empresaClienteId = params.empresaClienteId;
    if (params.ativa === "true") where.ativa = true;
    if (params.ativa === "false") where.ativa = false;
    return paginate(this.prisma.obra, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["nome", "empresaCliente.nome"],
      sortable: {
        nome: "nome",
        empresa: "empresaCliente.nome",
        ativa: "ativa",
        criadoEm: "criadoEm",
      },
      defaultSort: { field: "nome", order: "asc" },
      include: { empresaCliente: { select: { id: true, nome: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.obra.findUniqueOrThrow({
      where: { id },
      include: { empresaCliente: { select: { id: true, nome: true } } },
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
    const [locais, viagens] = await Promise.all([
      this.prisma.local.count({ where: { obraId: id } }),
      this.prisma.viagem.count({ where: { obraId: id } }),
    ]);
    const partes: string[] = [];
    if (locais > 0) partes.push(`${locais} local${locais === 1 ? "" : "is"}`);
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "s"}`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    await this.prisma.obra.delete({ where: { id } });
    return { ok: true };
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
