import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AtualizarRegraMinimoInput,
  CriarRegraMinimoInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListParams = PaginationQuery & { empresaId?: string; ativo?: "true" | "false" };

const INCLUDE = {
  empresa: { select: { id: true, nome: true } },
  material: { select: { id: true, nome: true } },
} satisfies Prisma.RegraMinimoInclude;

@Injectable()
export class RegrasMinimoService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListParams) {
    const where: Prisma.RegraMinimoWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.regraMinimo, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: não há o que filtrar por transportadora. O
      // isolamento entre EMPRESAS aqui é da trava de conta; o recorte por frota
      // fica com a matriz de papéis (não existe guard de escopo — ver escopo.ts).
      escopo: SEM_ESCOPO,
      searchFields: ["empresa.nome", "material.nome"],
      sortable: { kmFaixaDe: "kmFaixaDe", criadoEm: "criadoEm", ativo: "ativo" },
      defaultSort: { field: "criadoEm", order: "desc" },
      include: INCLUDE,
    });
  }

  findOne(id: string) {
    return this.prisma.regraMinimo.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }

  async create(data: CriarRegraMinimoInput, usuarioId: string) {
    await this.ensureEmpresa(data.empresaId);
    if (data.materialId) await this.ensureMaterial(data.materialId);
    return this.prisma.regraMinimo.create({
      data: { ...data, criadoPorId: usuarioId },
      include: INCLUDE,
    });
  }

  async update(id: string, data: AtualizarRegraMinimoInput) {
    await this.ensureExists(id);
    if (data.empresaId) await this.ensureEmpresa(data.empresaId);
    if (data.materialId) await this.ensureMaterial(data.materialId);
    return this.prisma.regraMinimo.update({ where: { id }, data, include: INCLUDE });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.regraMinimo.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const r = await this.prisma.regraMinimo.findUnique({ where: { id } });
    if (!r) throw new NotFoundException("Regra não encontrada");
    return r;
  }
  private async ensureEmpresa(id: string) {
    const e = await this.prisma.empresa.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Empresa não encontrada");
  }
  private async ensureMaterial(id: string) {
    const m = await this.prisma.material.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Material não encontrado");
  }
}
