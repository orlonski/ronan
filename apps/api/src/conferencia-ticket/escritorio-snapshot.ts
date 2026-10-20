import { Injectable } from "@nestjs/common";
import { StatusViagem } from "@prisma/client";
import type { EscritorioSnapshot } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { contaIdAtual } from "../common/conta/conta-context";
import { STATUS_FORA_FECHAMENTO } from "../common/viagem-status";
import { ConferenciaConfig } from "./conferencia.config";

/** Janela das chegadas e dos veredictos que alimentam as animações da cena. */
export const JANELA_EVENTOS_MS = 10 * 60_000;
/** Teto de cada lista de eventos: a cena anima poucos e resume o resto. */
export const LIMITE_EVENTOS = 50;
/**
 * "Validadas 24h" olha só viagens de até 30 dias atrás. `revisadoEm` não tem
 * índice, e sem esse corte o count varreria todas as OK da conta; a data da
 * viagem tem (`contaId, data`). Aprovar uma viagem com mais de 30 dias de
 * idade dentro das últimas 24h é raro e fica de fora do número.
 */
export const JANELA_DATA_VALIDADAS_DIAS = 30;

export type EntradaSnapshot = {
  agora: Date;
  robo: { ativo: boolean; modoSombra: boolean };
  fila: number;
  validadas24h: number;
  devolvidas: number;
  ajustadas: number;
  travadas: number;
  /** Quando a travada mais antiga ficou parada (fim da última leitura dela). */
  travadaMaisAntigaDesde: Date | null;
  chegadas: { id: string; em: Date }[];
  veredictos: {
    id: string;
    viagemId: string;
    em: Date;
    veredito: "BATE" | "DIVERGE" | "INCERTO" | "ILEGIVEL" | "NAO_APLICAVEL";
    acao: string | null;
    passadas: number;
    escalouEm: Date | null;
  }[];
};

/**
 * Monta o snapshot a partir de dados já lidos. Pura: o recorte de janela e o
 * limite são reaplicados aqui de propósito, pra que o contrato não dependa de a
 * query ter acertado o filtro.
 */
export function montarSnapshotEscritorio(e: EntradaSnapshot): EscritorioSnapshot {
  const t = e.agora.getTime();
  const dentro = (d: Date) => t - d.getTime() <= JANELA_EVENTOS_MS && d.getTime() <= t;
  const recentesPrimeiro = <T extends { em: Date }>(l: T[]) =>
    [...l].filter((x) => dentro(x.em)).sort((a, b) => b.em.getTime() - a.em.getTime()).slice(0, LIMITE_EVENTOS);

  return {
    geradoEm: e.agora.toISOString(),
    robo: e.robo,
    contagens: {
      fila: e.fila,
      validadas24h: e.validadas24h,
      devolvidas: e.devolvidas,
      ajustadas: e.ajustadas,
      travadas: e.travadas,
    },
    travadaMaisAntigaMin:
      e.travadas > 0 && e.travadaMaisAntigaDesde
        ? Math.max(0, Math.floor((t - e.travadaMaisAntigaDesde.getTime()) / 60_000))
        : null,
    chegadas: recentesPrimeiro(e.chegadas).map((c) => ({ id: c.id, em: c.em.toISOString() })),
    veredictos: recentesPrimeiro(e.veredictos).map((v) => ({
      id: v.id,
      viagemId: v.viagemId,
      em: v.em.toISOString(),
      veredito: v.veredito,
      acao: v.acao,
      segundaLeitura: v.passadas > 1 || v.escalouEm != null,
    })),
  };
}

/**
 * A foto do pipeline de conferência pro "Escritório de Agentes". Leitura pura,
 * no contexto de conta de quem pede (a trava do Prisma filtra por conta).
 *
 * Fora das contagens ficam as viagens vindas de integração externa
 * (`origemIntegracaoId`): o agente nunca leu o ticket delas, então
 * "devolvida"/"travada" ali seria um estado que a cena não pode explicar. E
 * ficam fora os status de `STATUS_FORA_FECHAMENTO` (incompletas).
 */
@Injectable()
export class EscritorioSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConferenciaConfig,
  ) {}

  async snapshot(agora = new Date()): Promise<EscritorioSnapshot> {
    const desdeEventos = new Date(agora.getTime() - JANELA_EVENTOS_MS);
    const desde24h = new Date(agora.getTime() - 24 * 3_600_000);
    const desdeData = new Date(agora.getTime() - JANELA_DATA_VALIDADAS_DIAS * 86_400_000);
    const doApp = { origemIntegracaoId: null, status: { notIn: STATUS_FORA_FECHAMENTO } };
    const emConferencia = { ...doApp, status: StatusViagem.EM_CONFERENCIA, revisadoEm: null };

    const [conta, fila, validadas24h, devolvidas, ajustadas, travadas, maisAntiga, chegadas, veredictos] =
      await Promise.all([
        this.prisma.conta.findUnique({ where: { id: contaIdAtual() }, select: { iaConferenciaTicket: true } }),
        this.prisma.conferenciaTicket.count({ where: { status: { in: ["PENDENTE", "EXECUTANDO"] } } }),
        this.prisma.viagem.count({
          where: { ...doApp, status: StatusViagem.OK, revisadoEm: { gte: desde24h }, data: { gte: desdeData } },
        }),
        this.prisma.viagem.count({ where: { ...doApp, status: StatusViagem.DIVERGENTE } }),
        this.prisma.viagem.count({ where: { ...doApp, status: StatusViagem.AJUSTADA, revisadoEm: null } }),
        this.prisma.viagem.count({ where: emConferencia }),
        // O "desde" da travada: a viagem não guarda quando entrou em
        // EM_CONFERENCIA, então vale o fim da ÚLTIMA leitura dela (o robô é o
        // único que escreve esse status). groupBy + _max devolve uma linha por
        // viagem; ordenar e pegar 1 traz a mais antiga sem varrer em memória.
        this.prisma.conferenciaTicket.groupBy({
          by: ["viagemId"],
          where: { status: "CONCLUIDA", finalizadoEm: { not: null }, viagem: emConferencia },
          _max: { finalizadoEm: true },
          orderBy: { _max: { finalizadoEm: "asc" } },
          take: 1,
        }),
        this.prisma.viagem.findMany({
          where: { ...doApp, sincronizadoEm: { gte: desdeEventos } },
          orderBy: { sincronizadoEm: "desc" },
          take: LIMITE_EVENTOS,
          select: { id: true, sincronizadoEm: true },
        }),
        this.prisma.conferenciaTicket.findMany({
          where: { status: "CONCLUIDA", finalizadoEm: { gte: desdeEventos }, veredito: { not: null } },
          orderBy: { finalizadoEm: "desc" },
          take: LIMITE_EVENTOS,
          select: { id: true, viagemId: true, finalizadoEm: true, veredito: true, acao: true, passadas: true, escalouEm: true },
        }),
      ]);

    return montarSnapshotEscritorio({
      agora,
      robo: { ativo: this.config.habilitado && !!conta?.iaConferenciaTicket, modoSombra: this.config.modoSombra },
      fila,
      validadas24h,
      devolvidas,
      ajustadas,
      travadas,
      travadaMaisAntigaDesde: maisAntiga[0]?._max.finalizadoEm ?? null,
      chegadas: chegadas.map((v) => ({ id: v.id, em: v.sincronizadoEm })),
      veredictos: veredictos.flatMap((c) =>
        c.finalizadoEm && c.veredito
          ? [{ id: c.id, viagemId: c.viagemId, em: c.finalizadoEm, veredito: c.veredito, acao: c.acao, passadas: c.passadas, escalouEm: c.escalouEm }]
          : [],
      ),
    });
  }
}
