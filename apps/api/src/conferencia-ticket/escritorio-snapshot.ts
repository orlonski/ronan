import { Injectable } from "@nestjs/common";
import { Prisma, StatusViagem } from "@prisma/client";
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
/**
 * As listas de eventos NÃO têm índice por `sincronizadoEm`/`finalizadoEm`: sem
 * um corte que case com índice existente, cada chamada varria a tabela inteira
 * (medido: seq scan de 300 mil linhas, ~23 mil buffers só em conferencias_ticket).
 * Então cada lista leva também um corte pelo índice que já existe:
 *  - chegadas: `data` da viagem (índice contaId+data). Viagem lançada offline e
 *    sincronizada com mais de 3 dias de atraso não anima a chegada.
 *  - veredictos: `criadoEm` do job (índice contaId+criadoEm). Job que levou mais
 *    de 2 dias entre enfileirar e concluir não anima o carimbo.
 * Os contadores não dependem disso: continuam exatos.
 */
export const JANELA_DATA_CHEGADAS_DIAS = 3;
export const JANELA_CRIACAO_VEREDICTOS_DIAS = 2;
/** Cache do snapshot por conta: N abas abertas = 1 cálculo a cada TTL. */
export const TTL_SNAPSHOT_MS = 10_000;
/** A "travada mais antiga" é a parte mais cara e muda devagar: TTL próprio. */
export const TTL_TRAVADA_MS = 60_000;
/** Se o cálculo falha, serve o último bom por até isto em vez de devolver erro. */
export const VALIDADE_STALE_MS = 120_000;
/** Cada consulta do snapshot falha rápido em vez de segurar a conexão. */
export const TIMEOUT_CONSULTA_MS = 4_000;
/** A travada mais antiga é medida entre as N mais antigas pela data da viagem. */
export const AMOSTRA_TRAVADAS = 200;

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
 *
 * ⚠️ É chamada em polling por toda aba aberta, então o custo importa mais que
 * a exatidão do último segundo. A 1ª versão disparou 9 consultas em paralelo,
 * 3 delas varrendo tabela inteira, e travou o banco da produção (20/10/2026).
 * Hoje: (1) cache por conta + uma só execução em voo; (2) UMA transação = UMA
 * conexão, consultas em sequência, cada uma com `statement_timeout`; (3) nenhuma
 * consulta sem índice.
 */
@Injectable()
export class EscritorioSnapshotService {
  private readonly cache = new Map<string, { em: number; valor: EscritorioSnapshot }>();
  private readonly emVoo = new Map<string, Promise<EscritorioSnapshot>>();
  private readonly cacheTravada = new Map<string, { em: number; desde: Date | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConferenciaConfig,
  ) {}

  async snapshot(agora = new Date(), opcoes: { semCache?: boolean } = {}): Promise<EscritorioSnapshot> {
    const contaId = contaIdAtual();
    if (opcoes.semCache) return this.calcular(contaId, agora);

    const hit = this.cache.get(contaId);
    if (hit && Date.now() - hit.em < TTL_SNAPSHOT_MS) return hit.valor;
    const voando = this.emVoo.get(contaId);
    if (voando) return voando;

    const p = this.calcular(contaId, agora)
      .then((valor) => {
        this.cache.set(contaId, { em: Date.now(), valor });
        return valor;
      })
      .catch((erro) => {
        // Banco lento ou timeout: o painel prefere um número de 1 minuto atrás
        // a um erro — e, principalmente, não faz a próxima aba re-disparar.
        const velho = this.cache.get(contaId);
        if (velho && Date.now() - velho.em < VALIDADE_STALE_MS) return velho.valor;
        throw erro;
      })
      .finally(() => this.emVoo.delete(contaId));
    this.emVoo.set(contaId, p);
    return p;
  }

  private calcular(contaId: string, agora: Date): Promise<EscritorioSnapshot> {
    const desdeEventos = new Date(agora.getTime() - JANELA_EVENTOS_MS);
    const desde24h = new Date(agora.getTime() - 24 * 3_600_000);
    const desdeData = new Date(agora.getTime() - JANELA_DATA_VALIDADAS_DIAS * 86_400_000);
    const desdeDataChegadas = new Date(agora.getTime() - JANELA_DATA_CHEGADAS_DIAS * 86_400_000);
    const desdeCriacao = new Date(agora.getTime() - JANELA_CRIACAO_VEREDICTOS_DIAS * 86_400_000);
    const doApp = { origemIntegracaoId: null, status: { notIn: STATUS_FORA_FECHAMENTO } };
    const emConferencia = { ...doApp, status: StatusViagem.EM_CONFERENCIA, revisadoEm: null };

    // Uma transação = uma conexão do pool pra todo o snapshot, e o SET LOCAL
    // vale só nela. Sequencial de propósito: 9 consultas em paralelo ocupavam
    // 9 conexões por requisição e enfileiravam o resto do sistema atrás.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${TIMEOUT_CONSULTA_MS}`);

        const conta = await tx.conta.findUnique({ where: { id: contaId }, select: { iaConferenciaTicket: true } });
        const fila = await tx.conferenciaTicket.count({ where: { status: { in: ["PENDENTE", "EXECUTANDO"] } } });
        const validadas24h = await tx.viagem.count({
          where: { ...doApp, status: StatusViagem.OK, revisadoEm: { gte: desde24h }, data: { gte: desdeData } },
        });
        const devolvidas = await tx.viagem.count({ where: { ...doApp, status: StatusViagem.DIVERGENTE } });
        const ajustadas = await tx.viagem.count({ where: { ...doApp, status: StatusViagem.AJUSTADA, revisadoEm: null } });
        const travadas = await tx.viagem.count({ where: emConferencia });

        let travadaMaisAntigaDesde: Date | null = null;
        if (travadas > 0) {
          const c = this.cacheTravada.get(contaId);
          if (c && Date.now() - c.em < TTL_TRAVADA_MS) travadaMaisAntigaDesde = c.desde;
          else {
            // O "desde" da travada: a viagem não guarda quando entrou em
            // EM_CONFERENCIA, então vale o fim da ÚLTIMA leitura dela (o robô é
            // o único que escreve esse status). Mede só as AMOSTRA mais antigas
            // pela data da viagem: custo limitado, e a mais antiga está entre elas.
            // SQL cru não passa pela trava de conta: o contaId é explícito.
            const linhas = await tx.$queryRaw<{ desde: Date | null }[]>(Prisma.sql`
              SELECT MIN(u.fim) AS desde FROM (
                SELECT (SELECT MAX(c."finalizadoEm") FROM "conferencias_ticket" c
                        WHERE c."viagemId" = v.id AND c."contaId" = ${contaId}
                          AND c.status = 'CONCLUIDA'::"StatusConferenciaTicket") AS fim
                FROM (SELECT id FROM "viagens"
                      WHERE "contaId" = ${contaId} AND status = 'EM_CONFERENCIA'::"StatusViagem"
                        AND "revisadoEm" IS NULL AND "origemIntegracaoId" IS NULL
                      ORDER BY data ASC LIMIT ${AMOSTRA_TRAVADAS}) v
              ) u`);
            travadaMaisAntigaDesde = linhas[0]?.desde ?? null;
            this.cacheTravada.set(contaId, { em: Date.now(), desde: travadaMaisAntigaDesde });
          }
        }

        const chegadas = await tx.viagem.findMany({
          where: { ...doApp, data: { gte: desdeDataChegadas }, sincronizadoEm: { gte: desdeEventos } },
          orderBy: { sincronizadoEm: "desc" },
          take: LIMITE_EVENTOS,
          select: { id: true, sincronizadoEm: true },
        });
        const veredictos = await tx.conferenciaTicket.findMany({
          where: {
            status: "CONCLUIDA",
            criadoEm: { gte: desdeCriacao },
            finalizadoEm: { gte: desdeEventos },
            veredito: { not: null },
          },
          orderBy: { finalizadoEm: "desc" },
          take: LIMITE_EVENTOS,
          select: { id: true, viagemId: true, finalizadoEm: true, veredito: true, acao: true, passadas: true, escalouEm: true },
        });

        return montarSnapshotEscritorio({
          agora,
          robo: { ativo: this.config.habilitado && !!conta?.iaConferenciaTicket, modoSombra: this.config.modoSombra },
          fila,
          validadas24h,
          devolvidas,
          ajustadas,
          travadas,
          travadaMaisAntigaDesde,
          chegadas: chegadas.map((v) => ({ id: v.id, em: v.sincronizadoEm })),
          veredictos: veredictos.flatMap((c) =>
            c.finalizadoEm && c.veredito
              ? [{ id: c.id, viagemId: c.viagemId, em: c.finalizadoEm, veredito: c.veredito, acao: c.acao, passadas: c.passadas, escalouEm: c.escalouEm }]
              : [],
          ),
        });
      },
      { maxWait: 3_000, timeout: 20_000 },
    );
  }
}
