import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, TipoLocal } from "@prisma/client";
import type { CriarLocalInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListLocaisParams = PaginationQuery & {
  obraId?: string;
  tipo?: TipoLocal;
  ativo?: "true" | "false";
};

@Injectable()
export class LocaisService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListLocaisParams) {
    const where: Prisma.LocalWhereInput = {};
    if (params.obraId) where.obraId = params.obraId;
    if (params.tipo) where.tipo = params.tipo;
    if (params.ativo === "true") where.ativo = true;
    else if (params.ativo === "false") where.ativo = false;
    else where.ativo = true; // default: só ativos (mantém comportamento anterior)
    return paginate(this.prisma.local, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["nome", "logradouro", "bairro", "cidade", "pontoReferencia"],
      sortable: {
        nome: "nome",
        cidade: "cidade",
        uf: "uf",
        tipo: "tipo",
        ativo: "ativo",
        criadoEm: "criadoEm",
      },
      defaultSort: { field: "nome", order: "asc" },
      include: { obra: { select: { id: true, nome: true } } },
    });
  }

  async create(data: CriarLocalInput) {
    return this.prisma.local.create({ data: data as Prisma.LocalUncheckedCreateInput });
  }

  async update(id: string, data: Partial<CriarLocalInput> & { ativo?: boolean }) {
    await this.ensureExists(id);
    return this.prisma.local.update({
      where: { id },
      data: data as Prisma.LocalUncheckedUpdateInput,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [carga, descarga] = await Promise.all([
      this.prisma.viagem.count({ where: { localCargaId: id } }),
      this.prisma.viagem.count({ where: { localDescargaId: id } }),
    ]);
    const total = carga + descarga;
    if (total > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${total} viagem${total === 1 ? "" : "s"} (${carga} de carga, ${descarga} de descarga). Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    // RotaCache sai cascade via schema
    await this.prisma.local.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const l = await this.prisma.local.findUnique({ where: { id } });
    if (!l) throw new NotFoundException("Local não encontrado");
    return l;
  }
}
