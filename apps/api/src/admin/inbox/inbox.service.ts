import { Injectable, Logger, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { Prisma, type AdminNotificacao } from "@prisma/client";
import { Subject, type Observable } from "rxjs";
import { PrismaService } from "../../prisma/prisma.service";

export type TipoNotificacaoAdmin =
  | "nova-viagem"
  | "resposta-divergencia-pedagio"
  | "resposta-divergencia-km"
  | "resposta-divergencia-foto"
  | "nova-mensagem-viagem"
  | "foto-anexada"
  | "local-em-validacao"
  | "motorista-cadastro"
  | "motorista-senha-reset";

export type DispararNotificacaoInput = {
  tipo: TipoNotificacaoAdmin;
  titulo: string;
  corpo: string;
  dados?: Prisma.InputJsonValue;
};

/**
 * Caixa de entrada dos admins. Eventos relevantes do motorista (nova viagem,
 * resposta de divergência, etc) são duplicados pra todos admin/operador ativos
 * (fan-out). Cada user marca como lida na sua cópia.
 *
 * Realtime: mantém um Map<usuarioId, Subject<AdminNotificacao>>. Quando uma
 * notificação é criada, emite no Subject do user. O SSE controller assina pra
 * empurrar pro browser. Single-process: se a API virar cluster, trocar por
 * Redis pub/sub.
 */
@Injectable()
export class AdminInboxService implements OnModuleDestroy {
  private readonly log = new Logger(AdminInboxService.name);
  private readonly streams = new Map<string, Subject<AdminNotificacao>>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    for (const s of this.streams.values()) s.complete();
    this.streams.clear();
  }

  /**
   * Fan-out: cria 1 linha por admin/operador ativo e emite no stream de cada
   * um. Best-effort: erro aqui não derruba a operação que disparou (caller
   * sempre envolve em try/catch).
   */
  async disparar(input: DispararNotificacaoInput): Promise<void> {
    // Filtrar o fan-out NA ORIGEM é obrigatório: as linhas nascem pertencendo
    // ao usuário (`where: { usuarioId }` na leitura), então escopar o GET não
    // adiantaria nada — o sininho e o SSE já teriam entregue nome de motorista,
    // ticket e valor de outra frota em tempo real.
    const transportadoraId = await this.transportadoraDoEvento(input.dados);
    const destinos = await this.prisma.user.findMany({
      where: {
        ativo: true,
        OR: [
          { acessoGlobal: true },
          // Usuário restrito só recebe evento de frota que ele enxerga. Evento
          // sem frota resolvida (lançamento de cadastro ainda não classificado)
          // fica só com quem tem acesso global — fail-closed.
          ...(transportadoraId
            ? [{ transportadoras: { some: { transportadoraId } } }]
            : []),
        ],
      },
      select: { id: true },
    });
    if (destinos.length === 0) return;

    // createMany não retorna os registros criados; fazemos individual pra
    // conseguir emitir no stream. N pequeno (~poucos admins) — sem problema.
    await Promise.all(
      destinos.map(async (d) => {
        const notif = await this.prisma.adminNotificacao.create({
          data: {
            usuarioId: d.id,
            tipo: input.tipo,
            titulo: input.titulo,
            corpo: input.corpo,
            dados: input.dados ?? Prisma.JsonNull,
          },
        });
        const subj = this.streams.get(d.id);
        if (subj) subj.next(notif);
      }),
    );
  }

  /**
   * De qual frota é o evento, deduzido dos `dados` que o caller já manda
   * (`viagemId` ou `motoristaId`).
   *
   * Resolvido AQUI, e não em cada caller, de propósito: são 4 pontos de
   * disparo hoje e nenhum deles pode virar vazamento por esquecimento. Custa
   * uma query num caminho que já é fire-and-forget.
   */
  private async transportadoraDoEvento(
    dados: Prisma.InputJsonValue | undefined,
  ): Promise<string | null> {
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
    const d = dados as Record<string, unknown>;

    if (typeof d.viagemId === "string") {
      const v = await this.prisma.viagem.findUnique({
        where: { id: d.viagemId },
        select: { transportadoraId: true },
      });
      if (v?.transportadoraId) return v.transportadoraId;
    }
    if (typeof d.motoristaId === "string") {
      const m = await this.prisma.motorista.findUnique({
        where: { id: d.motoristaId },
        select: { transportadoraId: true },
      });
      if (m?.transportadoraId) return m.transportadoraId;
    }
    return null;
  }

  /**
   * Observable pro user — usado pelo @Sse() controller. Cria o Subject se
   * não existe ainda. Cuidado: nunca chame .complete() daqui — o controller
   * fecha quando o cliente desconecta.
   */
  stream(usuarioId: string): Observable<AdminNotificacao> {
    let subj = this.streams.get(usuarioId);
    if (!subj) {
      subj = new Subject<AdminNotificacao>();
      this.streams.set(usuarioId, subj);
    }
    return subj.asObservable();
  }

  async listar(
    usuarioId: string,
    args: { limit?: number; cursor?: string; somenteNaoLidas?: boolean },
  ): Promise<{ itens: AdminNotificacao[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    const where: Prisma.AdminNotificacaoWhereInput = { usuarioId };
    if (args.somenteNaoLidas) where.lida = false;
    const itens = await this.prisma.adminNotificacao.findMany({
      where,
      orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    });
    const hasMore = itens.length > limit;
    const page = hasMore ? itens.slice(0, limit) : itens;
    return {
      itens: page,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  contarNaoLidas(usuarioId: string): Promise<number> {
    return this.prisma.adminNotificacao.count({
      where: { usuarioId, lida: false },
    });
  }

  async marcarLida(id: string, usuarioId: string): Promise<AdminNotificacao> {
    const existente = await this.prisma.adminNotificacao.findUnique({
      where: { id },
      select: { usuarioId: true },
    });
    if (!existente) throw new NotFoundException("Notificação não encontrada.");
    if (existente.usuarioId !== usuarioId) {
      // Não vaza ownership: trata como não encontrada.
      throw new NotFoundException("Notificação não encontrada.");
    }
    return this.prisma.adminNotificacao.update({
      where: { id },
      data: { lida: true, lidaEm: new Date() },
    });
  }

  async marcarTodasLidas(usuarioId: string): Promise<{ marcadas: number }> {
    const r = await this.prisma.adminNotificacao.updateMany({
      where: { usuarioId, lida: false },
      data: { lida: true, lidaEm: new Date() },
    });
    return { marcadas: r.count };
  }
}
