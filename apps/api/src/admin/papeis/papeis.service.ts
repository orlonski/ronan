import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CriarPapelInput, AtualizarPapelInput } from "@ronan/shared-types";
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

  async create(input: CriarPapelInput) {
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
