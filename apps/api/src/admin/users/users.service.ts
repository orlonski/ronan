import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ASSUNTOS_RESUMO_IDS, type CriarUserInput, type AtualizarUserInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { PAPEL_OPERADOR } from "../permissoes/permissoes.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListUsersParams = PaginationQuery & {
  ativo?: "true" | "false";
};

const SAFE_SELECT = {
  id: true,
  nome: true,
  email: true,
  ativo: true,
  ultimoLoginEm: true,
  whatsappResumo: true,
  receberResumoDiario: true,
  resumoAssuntos: true,
  papelId: true,
  papel: { select: { id: true, nome: true, permissoes: true } },
  acessoGlobal: true,
  transportadoras: {
    select: { transportadora: { select: { id: true, nome: true } } },
    orderBy: { transportadora: { nome: "asc" } },
  },
  criadoEm: true,
  criadoPor: { select: { id: true, nome: true } },
} as const;

/** Achata o N:N pro frontend: `transportadoras: [{id, nome}]`. */
function serializar<T extends { transportadoras: { transportadora: { id: string; nome: string } }[] }>(
  u: T,
) {
  return { ...u, transportadoras: u.transportadoras.map((t) => t.transportadora) };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListUsersParams) {
    const where: Prisma.UserWhereInput = {};
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    const result = await paginate<
      { transportadoras: { transportadora: { id: string; nome: string } }[] },
      ListUsersParams
    >(this.prisma.user, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: quem barra o usuário restrito é o EscopoGuard.
      escopo: SEM_ESCOPO,
      searchFields: ["nome", "email"],
      sortable: {
        nome: "nome",
        email: "email",
        ativo: "ativo",
        ultimoLoginEm: "ultimoLoginEm",
        criadoEm: "criadoEm",
      },
      defaultSort: { field: "nome", order: "asc" },
      select: SAFE_SELECT as unknown as Record<string, unknown>,
    });
    return { ...result, data: result.data.map(serializar) };
  }

  async findOne(id: string) {
    return serializar(
      await this.prisma.user.findUniqueOrThrow({ where: { id }, select: SAFE_SELECT }),
    );
  }

  async create(data: CriarUserInput, usuarioId: string) {
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException("Email já cadastrado");
    // Sem papel escolhido → cai no Operador (evita usuário sem acesso nenhum).
    let papelId = data.papelId ?? null;
    if (!papelId) {
      const papel = await this.prisma.papel.findFirst({
        where: { nome: PAPEL_OPERADOR },
        select: { id: true },
      });
      papelId = papel?.id ?? null;
    }
    const acessoGlobal = data.acessoGlobal ?? true;
    await this.validarTransportadoras(data.transportadoraIds);
    return serializar(
      await this.prisma.user.create({
        data: {
          nome: data.nome,
          email: data.email,
          senhaHash: await AuthService.hashPassword(data.senha),
          whatsappResumo: data.whatsappResumo || null,
          receberResumoDiario: data.receberResumoDiario ?? false,
          // Novo usuário recebe todos os assuntos por padrão (até personalizar).
          resumoAssuntos: data.resumoAssuntos ?? ASSUNTOS_RESUMO_IDS,
          papelId,
          acessoGlobal,
          ...(acessoGlobal
            ? {}
            : {
                transportadoras: {
                  create: (data.transportadoraIds ?? []).map((transportadoraId) => ({
                    transportadoraId,
                  })),
                },
              }),
          criadoPorId: usuarioId,
        },
        select: SAFE_SELECT,
      }),
    );
  }

  async update(id: string, data: AtualizarUserInput) {
    await this.ensureExists(id);
    const { senha, acessoGlobal, transportadoraIds, ...rest } = data;
    const update: Record<string, unknown> = { ...rest };
    if (senha) update.senhaHash = await AuthService.hashPassword(senha);
    // String vazia limpa o número (vira null).
    if ("whatsappResumo" in rest) update.whatsappResumo = rest.whatsappResumo || null;

    if (acessoGlobal !== undefined) update.acessoGlobal = acessoGlobal;
    // Vínculos: devolver o acesso global limpa a lista (senão sobraria escopo
    // fantasma que voltaria a valer se alguém restringisse o usuário de novo).
    if (acessoGlobal === true) {
      update.transportadoras = { deleteMany: {} };
    } else if (transportadoraIds !== undefined) {
      await this.validarTransportadoras(transportadoraIds);
      update.transportadoras = {
        deleteMany: {},
        create: transportadoraIds.map((transportadoraId) => ({ transportadoraId })),
      };
    }

    return serializar(
      await this.prisma.user.update({ where: { id }, data: update, select: SAFE_SELECT }),
    );
  }

  /** FK inválida vira 4xx claro em vez de 500 no nested create. */
  private async validarTransportadoras(ids: string[] | undefined) {
    if (!ids || ids.length === 0) return;
    const achadas = await this.prisma.transportadora.count({ where: { id: { in: ids } } });
    if (achadas !== new Set(ids).size) {
      throw new NotFoundException("Transportadora não encontrada");
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return serializar(
      await this.prisma.user.update({
        where: { id },
        data: { ativo: false },
        select: SAFE_SELECT,
      }),
    );
  }

  async me(id: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { ...SAFE_SELECT, plataforma: true, conta: { select: { id: true, nome: true, logoUrl: true } } },
    });
    // `permissoes` no topo facilita o frontend (sidebar/guards) checar acesso.
    // Vai ÍNTEGRO, inclusive pra usuário restrito a transportadora: quem decide
    // quais telas ele acessa é a matriz de papéis, não o backend cortando por
    // conta própria. Telas que não filtram por frota mostram tudo — a matriz
    // sinaliza quais são (selo "frota", ver EscopoRegistryService).
    //
    // `conta` e `plataforma` vêm juntos porque este endpoint é por onde o painel
    // recebe tudo do usuário logado (`usePermissoes`) — assim o nome da empresa
    // e a tela de contas não precisam de chamada nem de sessão nova.
    return {
      ...serializar(u),
      permissoes: u.papel?.permissoes ?? [],
      conta: u.conta,
      plataforma: u.plataforma,
    };
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Usuário não encontrado");
    return u;
  }
}
