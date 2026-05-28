import { Injectable, Logger } from "@nestjs/common";
import type { EventoMotoristaInput } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";

export type ListarEventosFiltro = {
  motoristaId?: string;
  viagemId?: string;
  viagemClientId?: string;
  tipo?: string | string[];
  desde?: Date;
  ate?: Date;
  online?: boolean;
  /** Default 100, max 500. */
  limit?: number;
  /** Cursor por id (ULID/UUID) — opcional. */
  cursor?: string;
};

@Injectable()
export class EventosService {
  private readonly logger = new Logger(EventosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste batch de eventos do motorista. Idempotente por id — reenvio do
   * mesmo evento (cliente fez retry) é ignorado silenciosamente. Tipo é
   * string livre (não enum) pra não rejeitar evento de cliente novo que
   * backend antigo não conhece.
   */
  async receberBatch(
    motoristaId: string,
    origem: "motorista-app" | "motorista-pwa",
    eventos: EventoMotoristaInput[],
  ) {
    if (eventos.length === 0) return { recebidos: 0 };

    await this.prisma.$transaction(async (tx) => {
      for (const e of eventos) {
        await tx.eventoMotorista.upsert({
          where: { id: e.id },
          create: {
            id: e.id,
            motoristaId,
            viagemClientId: e.viagemClientId ?? null,
            tipo: e.tipo.slice(0, 100),
            contexto: e.contexto as never,
            online: e.online,
            versaoApp: e.versaoApp?.slice(0, 100),
            origem,
            capturadoEm: new Date(e.capturadoEm),
          },
          // Reenvio: no-op (mantém primeiro registro).
          update: {},
        });
      }
    });

    // Após inserir, tenta reconciliar viagemId pra eventos que vieram com
    // viagemClientId de uma viagem já sincronizada (caso raro mas possível:
    // motorista enviou viagem, depois drenou eventos da fila offline).
    await this.reconciliarViagensPorClientId(
      eventos
        .map((e) => e.viagemClientId)
        .filter((v): v is string => typeof v === "string"),
    );

    return { recebidos: eventos.length };
  }

  /**
   * Chamado quando viagem é criada/upserted no backend. Faz backfill de
   * eventos disparados offline antes da viagem chegar — linka via clientId.
   * Idempotente: WHERE viagemId IS NULL evita sobrescrever.
   */
  async reconciliarPorClientId(viagemClientId: string, viagemId: string) {
    const r = await this.prisma.eventoMotorista.updateMany({
      where: { viagemClientId, viagemId: null },
      data: { viagemId },
    });
    if (r.count > 0) {
      this.logger.log(
        `Reconciliados ${r.count} eventos pra viagem ${viagemId} (clientId=${viagemClientId})`,
      );
    }
    return r;
  }

  /**
   * Para cada clientId, se já existe viagem com esse clientId, faz o backfill.
   * Usado após receber batch — alguns eventos podem ter viagemClientId de
   * viagens já criadas.
   */
  private async reconciliarViagensPorClientId(clientIds: string[]) {
    if (clientIds.length === 0) return;
    const viagens = await this.prisma.viagem.findMany({
      where: { clientId: { in: clientIds } },
      select: { id: true, clientId: true },
    });
    for (const v of viagens) {
      await this.reconciliarPorClientId(v.clientId, v.id);
    }
  }

  async listar(filtro: ListarEventosFiltro) {
    const where: Record<string, unknown> = {};
    if (filtro.motoristaId) where.motoristaId = filtro.motoristaId;
    if (filtro.viagemId) where.viagemId = filtro.viagemId;
    if (filtro.viagemClientId) where.viagemClientId = filtro.viagemClientId;
    if (filtro.tipo) {
      where.tipo = Array.isArray(filtro.tipo) ? { in: filtro.tipo } : filtro.tipo;
    }
    if (filtro.online !== undefined) where.online = filtro.online;
    if (filtro.desde || filtro.ate) {
      const range: Record<string, Date> = {};
      if (filtro.desde) range.gte = filtro.desde;
      if (filtro.ate) range.lte = filtro.ate;
      where.capturadoEm = range;
    }

    const take = Math.min(filtro.limit ?? 100, 500);
    return this.prisma.eventoMotorista.findMany({
      where,
      orderBy: { capturadoEm: "desc" },
      take,
      ...(filtro.cursor
        ? { cursor: { id: filtro.cursor }, skip: 1 }
        : {}),
      include: {
        motorista: { select: { id: true, nome: true } },
      },
    });
  }

  /**
   * Eventos de uma viagem específica. Combina match por viagemId (já
   * reconciliados) E viagemClientId (caso reconciliação ainda não rolou).
   */
  async listarPorViagem(viagemId: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { clientId: true },
    });
    if (!viagem) return [];
    return this.prisma.eventoMotorista.findMany({
      where: {
        OR: [
          { viagemId },
          { viagemClientId: viagem.clientId, viagemId: null },
        ],
      },
      orderBy: { capturadoEm: "asc" },
    });
  }
}
