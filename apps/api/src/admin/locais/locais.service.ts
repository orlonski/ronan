import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarLocalInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class LocaisService {
  constructor(private readonly prisma: PrismaService) {}

  list(obraId?: string) {
    return this.prisma.local.findMany({
      where: { ativo: true, ...(obraId ? { obraId } : {}) },
      include: { obra: { select: { id: true, nome: true } } },
      orderBy: { nome: "asc" },
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
    return this.prisma.local.update({ where: { id }, data: { ativo: false } });
  }

  private async ensureExists(id: string) {
    const l = await this.prisma.local.findUnique({ where: { id } });
    if (!l) throw new NotFoundException("Local não encontrado");
    return l;
  }
}
