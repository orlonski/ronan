import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarClienteInput, AtualizarClienteInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListClientesParams = PaginationQuery & {
  empresaId?: string;
  ativa?: "true" | "false";
};

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListClientesParams) {
    const where: Prisma.ClienteWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.ativa === "true") where.ativa = true;
    if (params.ativa === "false") where.ativa = false;
    return paginate(this.prisma.cliente, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: não há o que filtrar por transportadora. O
      // isolamento entre EMPRESAS aqui é da trava de conta; o recorte por frota
      // fica com a matriz de papéis (não existe guard de escopo — ver escopo.ts).
      escopo: SEM_ESCOPO,
      searchFields: ["nome", "empresa.nome"],
      sortable: {
        nome: "nome",
        empresa: "empresa.nome",
        ativa: "ativa",
        criadoEm: "criadoEm",
      },
      defaultSort: { field: "nome", order: "asc" },
      include: {
        empresa: { select: { id: true, nome: true } },
        criadoPor: { select: { id: true, nome: true } },
      },
    });
  }

  findOne(id: string) {
    return this.prisma.cliente.findUniqueOrThrow({
      where: { id },
      include: {
        empresa: { select: { id: true, nome: true } },
        criadoPor: { select: { id: true, nome: true } },
      },
    });
  }

  async create(data: CriarClienteInput, usuarioId: string) {
    await this.ensureEmpresa(data.empresaId);
    return this.prisma.cliente.create({ data: { ...data, criadoPorId: usuarioId } });
  }

  async update(id: string, data: AtualizarClienteInput) {
    const obra = await this.ensureExists(id);
    if (data.empresaId) await this.ensureEmpresa(data.empresaId);
    // Obra com viagem não muda de cliente (decisão do dono, 23/09/2026). O
    // mínimo e o preço são resolvidos pelo cliente NA HORA de mostrar
    // (viagem.cliente.empresaId): trocar o cliente reescreveria o faturado de
    // meses passados sem ninguém ver. Cadastro errado se corrige criando a
    // obra no cliente certo.
    if (data.empresaId && data.empresaId !== obra.empresaId) {
      const viagens = await this.prisma.viagem.count({ where: { clienteId: id } });
      if (viagens > 0) {
        throw new ConflictException(
          `Esta obra já tem ${viagens} viage${viagens === 1 ? "m" : "ns"} e não pode mudar de cliente: o mínimo e o preço dessas viagens mudariam junto. Se foi cadastrada no cliente errado, crie a obra no cliente certo.`,
        );
      }
    }
    return this.prisma.cliente.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [locais, viagens] = await Promise.all([
      this.prisma.localCliente.count({ where: { clienteId: id } }),
      this.prisma.viagem.count({ where: { clienteId: id } }),
    ]);
    const partes: string[] = [];
    if (locais > 0) partes.push(`${locais} local${locais === 1 ? "" : "is"}`);
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "s"}`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    await this.prisma.cliente.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const c = await this.prisma.cliente.findUnique({ where: { id } });
    if (!c) throw new NotFoundException("Obra não encontrada");
    return c;
  }

  private async ensureEmpresa(id: string) {
    const e = await this.prisma.empresa.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Cliente não encontrado");
    return e;
  }
}
