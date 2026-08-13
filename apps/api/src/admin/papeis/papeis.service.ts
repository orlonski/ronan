import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CHAVES_PLATAFORMA, type CriarPapelInput, type AtualizarPapelInput } from "@ronan/shared-types";
import { comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import { PAPEL_ADMIN } from "../permissoes/permissoes.service";

@Injectable()
export class PapeisService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const papeis = await this.prisma.papel.findMany({
      orderBy: [{ sistema: "desc" }, { nome: "asc" }],
      include: { _count: { select: { usuarios: true } } },
    });
    return papeis.map(({ _count, ...p }) => ({ ...p, usuarios: _count.usuarios }));
  }

  findOne(id: string) {
    return this.prisma.papel.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Impede que uma empresa cliente conceda a si mesma o que é da plataforma.
   *
   * Esconder o menu não basta: o admin da empresa tem `permissoes.gerenciar` (ele
   * monta os papéis da equipe dele), e sem esta trava bastaria criar um papel com
   * `whatsapp.gerenciar` e se atribuir — chegando na instância de WhatsApp que
   * todas as empresas dividem. O painel chama a API direto do navegador, então a
   * regra tem que morar aqui, não na tela.
   *
   * A conta da plataforma (a primeira, do dono) passa livre.
   */
  private async recusarChavesDePlataforma(chaves: string[] | undefined): Promise<void> {
    if (!chaves || chaves.length === 0) return;
    const proibidas = chaves.filter((c) => CHAVES_PLATAFORMA.includes(c));
    if (proibidas.length === 0) return;

    const contaId = contaIdAtual();
    const primeira = await comoSistema(() =>
      this.prisma.conta.findFirst({ orderBy: { criadaEm: "asc" }, select: { id: true } }),
    );
    if (primeira?.id === contaId) return;

    throw new BadRequestException(
      `Estas permissões são da plataforma e não podem ser concedidas aqui: ${proibidas.join(", ")}.`,
    );
  }

  async create(input: CriarPapelInput) {
    await this.recusarChavesDePlataforma(input.permissoes);
    const existe = await this.prisma.papel.findFirst({ where: { nome: input.nome } });
    if (existe) throw new ConflictException("Já existe um papel com esse nome.");
    return this.prisma.papel.create({
      data: {
        nome: input.nome,
        descricao: input.descricao,
        permissoes: input.permissoes ?? [],
        sistema: false,
      },
    });
  }

  async update(id: string, input: AtualizarPapelInput) {
    const papel = await this.prisma.papel.findUnique({ where: { id } });
    if (!papel) throw new NotFoundException("Papel não encontrado");
    // Administrador é o super-papel (sempre todas as permissões) — não editável.
    if (papel.nome === PAPEL_ADMIN) {
      throw new BadRequestException("O papel Administrador não pode ser editado.");
    }
    if (input.nome && input.nome !== papel.nome) {
      const existe = await this.prisma.papel.findFirst({ where: { nome: input.nome } });
      if (existe) throw new ConflictException("Já existe um papel com esse nome.");
    }
    await this.recusarChavesDePlataforma(input.permissoes);
    return this.prisma.papel.update({
      where: { id },
      data: {
        nome: input.nome,
        descricao: input.descricao,
        permissoes: input.permissoes,
      },
    });
  }

  async remove(id: string) {
    const papel = await this.prisma.papel.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true } } },
    });
    if (!papel) throw new NotFoundException("Papel não encontrado");
    if (papel.sistema) throw new BadRequestException("Papéis do sistema não podem ser excluídos.");
    if (papel._count.usuarios > 0) {
      throw new BadRequestException(
        `Há ${papel._count.usuarios} usuário(s) com este papel. Troque o papel deles antes de excluir.`,
      );
    }
    return this.prisma.papel.delete({ where: { id } });
  }
}
