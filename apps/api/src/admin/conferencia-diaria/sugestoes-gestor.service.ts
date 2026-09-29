import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type StatusSugestaoGestor, type TipoSugestaoGestor } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminInboxService } from "../inbox/inbox.service";

export type NovaSugestao = {
  tipo: TipoSugestaoGestor;
  motoristaId: string;
  conferenciaId?: string | null;
  resumo: string;
  evidencia: Prisma.InputJsonValue;
};

/** Tipos que se resolvem sozinhos quando o motorista volta a lançar. */
export const TIPOS_QUE_SE_RESOLVEM_LANCANDO: TipoSugestaoGestor[] = [
  "INATIVAR_VINCULO",
  "LANCAR_VIAGEM_FALTANTE",
];

/** Sugestão aberta há mais que isto vence: fila que nunca esvazia deixa de ser lida. */
const VALIDADE_DIAS = 30;

/**
 * A fila do gestor. O sistema PERCEBE e sugere; quem decide é uma pessoa.
 *
 * ⚠️ Este serviço nunca altera cadastro de motorista. Inativar vínculo só
 * acontece no handler de aprovação com usuário humano (ver
 * `ConferenciaDiariaService.aprovarSugestao`) — tem teste de invariante.
 *
 * Roda SEMPRE dentro de `comConta(...)`: a trava do Prisma escopa por conta.
 */
@Injectable()
export class SugestoesGestorService {
  private readonly log = new Logger("SugestoesGestor");

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: AdminInboxService,
  ) {}

  /**
   * Abre a sugestão — no máximo UMA aberta por motorista e tipo (`chaveViva`).
   * Pedir de novo devolve a que já existe: o motorista que toca "Saí da empresa"
   * três vezes não lota a fila do gestor.
   */
  async abrir(dados: NovaSugestao): Promise<{ id: string; criada: boolean }> {
    const chaveViva = `${dados.motoristaId}:${dados.tipo}`;
    try {
      const s = await this.prisma.sugestaoGestor.create({
        data: {
          tipo: dados.tipo,
          motoristaId: dados.motoristaId,
          conferenciaId: dados.conferenciaId ?? null,
          resumo: dados.resumo,
          evidencia: dados.evidencia,
          chaveViva,
        },
        select: { id: true },
      });
      return { id: s.id, criada: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existente = await this.prisma.sugestaoGestor.findFirst({
          where: { chaveViva },
          select: { id: true },
        });
        if (existente) return { id: existente.id, criada: false };
      }
      throw e;
    }
  }

  /** Sino do painel pra quem pode ver a tela. Best-effort: nunca derruba o fluxo. */
  async notificar(titulo: string, corpo: string, dados: Record<string, string>): Promise<void> {
    try {
      await this.inbox.disparar({
        tipo: "conferencia-diaria",
        titulo,
        corpo,
        dados,
        permissao: "conferencia-diaria.ver",
      });
    } catch (e) {
      this.log.warn(`não deu pra avisar o gestor: ${(e as Error).message}`);
    }
  }

  /** Fecha (sem decisão humana) as sugestões abertas que já não fazem sentido. */
  async encerrar(
    where: Prisma.SugestaoGestorWhereInput,
    status: Extract<StatusSugestaoGestor, "RESOLVIDA_SOZINHA" | "EXPIRADA" | "RECUSADA">,
    motivo: string,
  ): Promise<number> {
    const { count } = await this.prisma.sugestaoGestor.updateMany({
      where: { ...where, status: "ABERTA" },
      data: { status, chaveViva: null, decididaEm: new Date(), motivoDecisao: motivo },
    });
    return count;
  }

  /**
   * Varredura de manutenção da conta da vez:
   *  - INATIVAR_VINCULO / LANCAR_VIAGEM_FALTANTE viram RESOLVIDA_SOZINHA quando o
   *    motorista voltou a lançar (viagem que chegou depois da sugestão);
   *  - o que ficou aberto além da validade vira EXPIRADA.
   */
  async manter(agora: Date): Promise<{ resolvidas: number; expiradas: number }> {
    const abertas = await this.prisma.sugestaoGestor.findMany({
      where: { status: "ABERTA", tipo: { in: TIPOS_QUE_SE_RESOLVEM_LANCANDO }, motoristaId: { not: null } },
      select: { id: true, motoristaId: true, criadaEm: true },
    });
    let resolvidas = 0;
    for (const s of abertas) {
      const lancou = await this.prisma.viagem.findFirst({
        where: { motoristaId: s.motoristaId!, sincronizadoEm: { gt: s.criadaEm } },
        select: { id: true },
      });
      if (!lancou) continue;
      resolvidas += await this.encerrar({ id: s.id }, "RESOLVIDA_SOZINHA", "O motorista voltou a lançar viagem.");
    }
    const corte = new Date(agora.getTime() - VALIDADE_DIAS * 86_400_000);
    const expiradas = await this.encerrar(
      { criadaEm: { lt: corte } },
      "EXPIRADA",
      `Ficou aberta por mais de ${VALIDADE_DIAS} dias.`,
    );
    return { resolvidas, expiradas };
  }
}
