import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  CriarModalidadeMotoristaInput,
  AtualizarModalidadeMotoristaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { slugificar } from "../tipos-servico/slug";

type ListParams = PaginationQuery & { ativo?: "true" | "false" };

@Injectable()
export class ModalidadesService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListParams) {
    const where: Prisma.ModalidadeMotoristaWhereInput = {};
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.modalidadeMotorista, {
      params,
      where: where as Record<string, unknown>,
      // Catálogo compartilhado, sem coluna de frota — igual a Material/TipoServico.
      escopo: SEM_ESCOPO,
      searchFields: ["nome"],
      sortable: { nome: "nome", ordem: "ordem", criadoEm: "criadoEm", ativo: "ativo" },
      defaultSort: { field: "ordem", order: "asc" },
      include: {
        criadoPor: { select: { id: true, nome: true } },
        _count: { select: { motoristas: true } },
      },
    });
  }

  findOne(id: string) {
    return this.prisma.modalidadeMotorista.findUniqueOrThrow({
      where: { id },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  async create(data: CriarModalidadeMotoristaInput, usuarioId: string) {
    const nome = data.nome.trim();
    const existe = await this.prisma.modalidadeMotorista.findFirst({ where: { nome } });
    if (existe) throw new ConflictException("Modalidade já cadastrada");

    const slug = await this.slugLivre(slugificar(nome));
    return this.prisma.modalidadeMotorista.create({
      data: { ...data, nome, slug, criadoPorId: usuarioId },
    });
  }

  async update(id: string, data: AtualizarModalidadeMotoristaInput) {
    const atual = await this.ensureExists(id);
    if (data.nome && data.nome.trim() !== atual.nome) {
      const existe = await this.prisma.modalidadeMotorista.findFirst({
        where: { nome: data.nome.trim(), id: { not: id } },
      });
      if (existe) throw new ConflictException("Modalidade já cadastrada");
    }
    // `slug` NÃO é reescrito no rename: é a chave estável, e motorista já
    // classificado continua apontando pro mesmo registro.
    return this.prisma.modalidadeMotorista.update({
      where: { id },
      data: { ...data, ...(data.nome ? { nome: data.nome.trim() } : {}) },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Diferente do TipoServico (que conta viagens), aqui o vínculo é com o
    // MOTORISTA — apagar deixaria gente sem classificação sem avisar.
    const motoristas = await this.prisma.motorista.count({ where: { modalidadeId: id } });
    if (motoristas > 0) {
      throw new ConflictException(
        `Não é possível excluir: ${motoristas} motorista${motoristas === 1 ? "" : "s"} nessa modalidade. Use o toggle de ativar/inativar pra tirar do seletor sem desclassificar ninguém.`,
      );
    }
    return this.prisma.modalidadeMotorista.delete({ where: { id } });
  }

  private async slugLivre(base: string) {
    for (let i = 0; i < 50; i++) {
      const candidato = i === 0 ? base : `${base}-${i + 1}`;
      const existe = await this.prisma.modalidadeMotorista.findFirst({
        where: { slug: candidato },
      });
      if (!existe) return candidato;
    }
    throw new ConflictException("Não foi possível gerar um identificador pra esse nome.");
  }

  private async ensureExists(id: string) {
    const m = await this.prisma.modalidadeMotorista.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Modalidade não encontrada");
    return m;
  }
}
