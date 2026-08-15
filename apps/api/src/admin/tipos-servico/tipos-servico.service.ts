import { Injectable, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarTipoServicoInput, AtualizarTipoServicoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { slugificar } from "./slug";

type ListTiposServicoParams = PaginationQuery & { ativo?: "true" | "false" };

@Injectable()
export class TiposServicoService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListTiposServicoParams) {
    const where: Prisma.TipoServicoWhereInput = {};
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.tipoServico, {
      params,
      where: where as Record<string, unknown>,
      // Catálogo compartilhado, sem coluna de frota — mesma situação de Material.
      escopo: SEM_ESCOPO,
      searchFields: ["nome"],
      sortable: { nome: "nome", ordem: "ordem", criadoEm: "criadoEm", ativo: "ativo" },
      defaultSort: { field: "ordem", order: "asc" },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.tipoServico.findUniqueOrThrow({
      where: { id },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  async create(data: CriarTipoServicoInput, usuarioId: string) {
    const nome = data.nome.trim();
    const existeNome = await this.prisma.tipoServico.findFirst({ where: { nome } });
    if (existeNome) throw new ConflictException("Modo de serviço já cadastrado");

    const slug = await this.slugLivre(slugificar(nome));
    return this.prisma.tipoServico.create({
      data: { ...data, nome, slug, criadoPorId: usuarioId },
    });
  }

  async update(id: string, data: AtualizarTipoServicoInput) {
    const atual = await this.ensureExists(id);

    // O tipo padrão é o que toda viagem sem tipoServicoId herda (histórico
    // inteiro + app antigo). Desativá-lo apagaria o chão de todo mundo.
    if (atual.padrao && data.ativo === false) {
      throw new BadRequestException(
        "Esse é o modo de serviço padrão da conta — não dá pra desativar. Defina outro como padrão antes.",
      );
    }
    if (data.nome && data.nome.trim() !== atual.nome) {
      const existeNome = await this.prisma.tipoServico.findFirst({
        where: { nome: data.nome.trim(), id: { not: id } },
      });
      if (existeNome) throw new ConflictException("Modo de serviço já cadastrado");
    }
    // `slug` NÃO é reescrito no rename de propósito: é a chave estável usada no
    // seed/código, e viagem antiga continua apontando pro mesmo registro.
    return this.prisma.tipoServico.update({
      where: { id },
      data: { ...data, ...(data.nome ? { nome: data.nome.trim() } : {}) },
    });
  }

  async remove(id: string) {
    const atual = await this.ensureExists(id);
    if (atual.padrao) {
      throw new ConflictException(
        "Esse é o modo de serviço padrão da conta — não pode ser excluído. Defina outro como padrão antes.",
      );
    }
    const viagens = await this.prisma.viagem.count({ where: { tipoServicoId: id } });
    if (viagens > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${viagens} viagem${viagens === 1 ? "" : "s"}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    return this.prisma.tipoServico.delete({ where: { id } });
  }

  /**
   * Troca qual tipo é o padrão da conta. Precisa ser transacional: o índice
   * parcial único (uq_tipo_servico_padrao_por_conta) recusa dois padrões, então
   * o antigo tem que cair antes do novo subir.
   */
  async definirPadrao(id: string) {
    const alvo = await this.ensureExists(id);
    if (alvo.padrao) return alvo;
    if (!alvo.ativo) {
      throw new BadRequestException("Não dá pra tornar padrão um modo de serviço inativo.");
    }
    const [, novo] = await this.prisma.$transaction([
      this.prisma.tipoServico.updateMany({
        where: { padrao: true, id: { not: id } },
        data: { padrao: false },
      }),
      this.prisma.tipoServico.update({ where: { id }, data: { padrao: true } }),
    ]);
    return novo;
  }

  private async slugLivre(base: string) {
    // Sufixa até achar um livre. O @@unique é por conta, e a trava de conta do
    // Prisma já filtra o findFirst — então isso não colide com outra empresa.
    for (let i = 0; i < 50; i++) {
      const candidato = i === 0 ? base : `${base}-${i + 1}`;
      const existe = await this.prisma.tipoServico.findFirst({ where: { slug: candidato } });
      if (!existe) return candidato;
    }
    throw new ConflictException("Não foi possível gerar um identificador pra esse nome.");
  }

  private async ensureExists(id: string) {
    const t = await this.prisma.tipoServico.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Modo de serviço não encontrado");
    return t;
  }
}
