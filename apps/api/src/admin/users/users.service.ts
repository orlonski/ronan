import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PerfilUsuario, Prisma } from "@prisma/client";
import { ASSUNTOS_RESUMO_IDS, type CriarUserInput, type AtualizarUserInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListUsersParams = PaginationQuery & {
  perfil?: PerfilUsuario;
  ativo?: "true" | "false";
};

const SAFE_SELECT = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  ativo: true,
  ultimoLoginEm: true,
  whatsappResumo: true,
  receberResumoDiario: true,
  resumoAssuntos: true,
  papelId: true,
  papel: { select: { id: true, nome: true, permissoes: true } },
  criadoEm: true,
  criadoPor: { select: { id: true, nome: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListUsersParams) {
    const where: Prisma.UserWhereInput = {};
    if (params.perfil) where.perfil = params.perfil;
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.user, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["nome", "email"],
      sortable: {
        nome: "nome",
        email: "email",
        perfil: "perfil",
        ativo: "ativo",
        ultimoLoginEm: "ultimoLoginEm",
        criadoEm: "criadoEm",
      },
      defaultSort: { field: "nome", order: "asc" },
      select: SAFE_SELECT as unknown as Record<string, unknown>,
    });
  }

  findOne(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: SAFE_SELECT });
  }

  async create(data: CriarUserInput, usuarioId: string) {
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException("Email já cadastrado");
    // Sem papel escolhido → herda o padrão pelo perfil (evita usuário sem acesso).
    let papelId = data.papelId ?? null;
    if (!papelId) {
      const nome = data.perfil === "ADMIN" ? "Administrador" : "Operador";
      const papel = await this.prisma.papel.findUnique({ where: { nome }, select: { id: true } });
      papelId = papel?.id ?? null;
    }
    return this.prisma.user.create({
      data: {
        nome: data.nome,
        email: data.email,
        perfil: data.perfil,
        senhaHash: await AuthService.hashPassword(data.senha),
        whatsappResumo: data.whatsappResumo || null,
        receberResumoDiario: data.receberResumoDiario ?? false,
        // Novo usuário recebe todos os assuntos por padrão (até personalizar).
        resumoAssuntos: data.resumoAssuntos ?? ASSUNTOS_RESUMO_IDS,
        papelId,
        criadoPorId: usuarioId,
      },
      select: SAFE_SELECT,
    });
  }

  async update(id: string, data: AtualizarUserInput) {
    await this.ensureExists(id);
    const { senha, ...rest } = data;
    const update: Record<string, unknown> = { ...rest };
    if (senha) update.senhaHash = await AuthService.hashPassword(senha);
    // String vazia limpa o número (vira null).
    if ("whatsappResumo" in rest) update.whatsappResumo = rest.whatsappResumo || null;
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

  async me(id: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: SAFE_SELECT });
    // `permissoes` no topo facilita o frontend (sidebar/guards) checar acesso.
    return { ...u, permissoes: u.papel?.permissoes ?? [] };
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Usuário não encontrado");
    return u;
  }
}
