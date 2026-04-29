import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CriarUserInput, AtualizarUserInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";

const SAFE_SELECT = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  ativo: true,
  criadoEm: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({ select: SAFE_SELECT, orderBy: { nome: "asc" } });
  }

  async create(data: CriarUserInput) {
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException("Email já cadastrado");
    return this.prisma.user.create({
      data: {
        nome: data.nome,
        email: data.email,
        perfil: data.perfil,
        senhaHash: await AuthService.hashPassword(data.senha),
      },
      select: SAFE_SELECT,
    });
  }

  async update(id: string, data: AtualizarUserInput) {
    await this.ensureExists(id);
    const { senha, ...rest } = data;
    const update: Record<string, unknown> = { ...rest };
    if (senha) update.senhaHash = await AuthService.hashPassword(senha);
    return this.prisma.user.update({ where: { id }, data: update, select: SAFE_SELECT });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.user.update({
      where: { id },
      data: { ativo: false },
      select: SAFE_SELECT,
    });
  }

  me(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: SAFE_SELECT });
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Usuário não encontrado");
    return u;
  }
}
