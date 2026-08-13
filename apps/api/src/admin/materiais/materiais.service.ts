import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarMaterialInput, AtualizarMaterialInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListMateriaisParams = PaginationQuery & { ativo?: "true" | "false" };

@Injectable()
export class MateriaisService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListMateriaisParams) {
    const where: Prisma.MaterialWhereInput = {};
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.material, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: quem barra o usuário restrito é o EscopoGuard.
      escopo: SEM_ESCOPO,
      searchFields: ["nome"],
      sortable: { nome: "nome", criadoEm: "criadoEm", ativo: "ativo" },
      defaultSort: { field: "nome", order: "asc" },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.material.findUniqueOrThrow({
      where: { id },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  async create(data: CriarMaterialInput, usuarioId: string) {
    const exists = await this.prisma.material.findFirst({ where: { nome: data.nome } });
    if (exists) throw new ConflictException("Material já cadastrado");
    return this.prisma.material.create({ data: { ...data, criadoPorId: usuarioId } });
  }

  async update(id: string, data: AtualizarMaterialInput) {
    await this.ensureExists(id);
    return this.prisma.material.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const viagens = await this.prisma.viagem.count({ where: { materialId: id } });
    if (viagens > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${viagens} viagem${viagens === 1 ? "" : "s"}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    return this.prisma.material.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const m = await this.prisma.material.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Material não encontrado");
    return m;
  }
}
