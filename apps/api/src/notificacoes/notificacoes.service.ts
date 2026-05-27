import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListarNotificacoesAdminQuery,
  ListarNotificacoesAdminResponse,
  ListarNotificacoesQuery,
  ListarNotificacoesResponse,
  NotificacaoAdminItem,
  NotificacaoItem,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";

type EntregaStatus = "PENDENTE" | "ENTREGUE" | "ERRO";

@Injectable()
export class NotificacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    motoristaId: string,
    q: ListarNotificacoesQuery,
  ): Promise<ListarNotificacoesResponse> {
    const where: Prisma.NotificacaoWhereInput = { motoristaId };
    if (q.cursor) where.criadoEm = { lt: new Date(q.cursor) };

    const [rows, naoLidas] = await Promise.all([
      this.prisma.notificacao.findMany({
        where,
        orderBy: { criadoEm: "desc" },
        take: q.limit + 1,
      }),
      this.prisma.notificacao.count({ where: { motoristaId, lida: false } }),
    ]);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const itens: NotificacaoItem[] = page.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      corpo: n.corpo,
      dados: (n.dados as Record<string, unknown> | null) ?? null,
      lida: n.lida,
      lidaEm: n.lidaEm ? n.lidaEm.toISOString() : null,
      criadoEm: n.criadoEm.toISOString(),
    }));

    return {
      itens,
      nextCursor: hasMore ? page[page.length - 1]!.criadoEm.toISOString() : null,
      naoLidas,
    };
  }

  /**
   * `updateMany` com filtro `motoristaId` garante que nunca marca lida
   * de outro motorista (defense-in-depth) e é idempotente — se já lida
   * ou não existe, count vira 0 e nada quebra.
   */
  async marcarLida(motoristaId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.notificacao.updateMany({
      where: { id, motoristaId, lida: false },
      data: { lida: true, lidaEm: new Date() },
    });
    return { ok: true };
  }

  async marcarTodasLidas(motoristaId: string): Promise<{ count: number }> {
    const r = await this.prisma.notificacao.updateMany({
      where: { motoristaId, lida: false },
      data: { lida: true, lidaEm: new Date() },
    });
    return { count: r.count };
  }

  /**
   * Consumido pelo PushService antes do envio pro Expo. Persistir primeiro
   * garante que se Expo cair no meio, a entrada já está no banco como
   * PENDENTE — sobrevive até reinstall.
   */
  async registrar(input: {
    motoristaId: string;
    tipo: string;
    titulo: string;
    corpo: string;
    dados?: Record<string, unknown>;
    criadoPorId?: string | null;
  }): Promise<{ id: string }> {
    const n = await this.prisma.notificacao.create({
      data: {
        motoristaId: input.motoristaId,
        tipo: input.tipo,
        titulo: input.titulo,
        corpo: input.corpo,
        dados: (input.dados ?? undefined) as Prisma.InputJsonValue | undefined,
        criadoPorId: input.criadoPorId ?? null,
      },
      select: { id: true },
    });
    return n;
  }

  /**
   * Listagem admin: vê notificações de QUALQUER motorista, com filtros.
   * Inclui motorista (id, nome, cpf), entregaStatus, entregaErro, expoTicketId
   * — campos que o motorista não recebe, mas admin precisa pra auditoria.
   */
  async listarAdmin(q: ListarNotificacoesAdminQuery): Promise<ListarNotificacoesAdminResponse> {
    const where: Prisma.NotificacaoWhereInput = {};
    if (q.motoristaId) where.motoristaId = q.motoristaId;
    if (q.entregaStatus) where.entregaStatus = q.entregaStatus;
    if (q.lida !== undefined) where.lida = q.lida;
    if (q.cursor) where.criadoEm = { lt: new Date(q.cursor) };

    const rows = await this.prisma.notificacao.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      take: q.limit + 1,
      include: {
        motorista: { select: { id: true, nome: true, cpf: true } },
        criadoPor: { select: { id: true, nome: true } },
      },
    });

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const itens: NotificacaoAdminItem[] = page.map((n) => ({
      id: n.id,
      motorista: n.motorista,
      tipo: n.tipo,
      titulo: n.titulo,
      corpo: n.corpo,
      dados: (n.dados as Record<string, unknown> | null) ?? null,
      lida: n.lida,
      lidaEm: n.lidaEm ? n.lidaEm.toISOString() : null,
      entregaStatus: n.entregaStatus,
      entregaErro: n.entregaErro,
      expoTicketId: n.expoTicketId,
      criadoEm: n.criadoEm.toISOString(),
      criadoPor: n.criadoPor,
    }));

    return {
      itens,
      nextCursor: hasMore ? page[page.length - 1]!.criadoEm.toISOString() : null,
    };
  }

  /**
   * Hard delete pelo admin. Remove o registro da Notificacao — independente
   * do entregaStatus (admin pode querer limpar histórico antigo ou erros).
   * Sem efeito colateral além da remoção do row.
   */
  async excluirAdmin(id: string): Promise<void> {
    await this.prisma.notificacao.delete({ where: { id } });
  }

  async atualizarEntrega(
    id: string,
    patch: { entregaStatus?: EntregaStatus; entregaErro?: string | null; expoTicketId?: string | null },
  ): Promise<void> {
    await this.prisma.notificacao.update({
      where: { id },
      data: {
        ...(patch.entregaStatus ? { entregaStatus: patch.entregaStatus } : {}),
        ...(patch.entregaErro !== undefined ? { entregaErro: patch.entregaErro } : {}),
        ...(patch.expoTicketId !== undefined ? { expoTicketId: patch.expoTicketId } : {}),
      },
    });
  }
}
