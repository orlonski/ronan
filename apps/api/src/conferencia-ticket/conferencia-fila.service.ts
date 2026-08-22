import { Injectable, Logger } from "@nestjs/common";
import {
  Prisma,
  StatusConferenciaTicket,
  StatusViagem,
  type ConferenciaTicket,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ConferenciaConfig } from "./conferencia.config";
import { comoSistema, contaIdAtual } from "../common/conta/conta-context";
import { STATUS_FORA_FECHAMENTO } from "../common/viagem-status";
import {
  compararDeclaradoComLido,
  type Declarado,
  type Lido,
} from "../common/conferencia-ticket";

/** Backoff exponencial (30s, 60s, 120s…) com teto de 15 min. */
export function atrasoBackoffMs(tentativa: number): number {
  const base = 30_000 * 2 ** Math.max(0, tentativa - 1);
  return Math.min(base, 15 * 60_000);
}

export type OrigemConferencia =
  | "create"
  | "finalizar"
  | "completar-peso"
  | "foto-avulsa"
  | "foto-divergente"
  | "reconferencia";

/**
 * A fila da conferência. Vive no Postgres pelos mesmos motivos da fila do
 * agente: o serviço reinicia no deploy, pode haver mais de uma réplica, e
 * nenhuma dessas garantias sobrevive num Map em memória.
 */
@Injectable()
export class ConferenciaFilaService {
  private readonly log = new Logger("ConferenciaTicket");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConferenciaConfig,
  ) {}

  /**
   * Enfileira a conferência de uma viagem. **Nunca lança** — quem chama usa
   * `void` do lado do lançamento do motorista, e promise rejeitada sob `void`
   * derruba o processo.
   *
   * Roda no contexto de conta da requisição: a trava do Prisma carimba o
   * `contaId` sozinha.
   */
  async enfileirar(viagemId: string, origem: OrigemConferencia): Promise<void> {
    try {
      // A torneira da plataforma. Cada conferência custa dinheiro, e quem paga
      // é a plataforma — então a empresa precisa estar liberada na tela de
      // Empresas antes de qualquer job entrar na fila. Barrar aqui (e não no
      // worker) evita encher a tabela de trabalho que nunca vai rodar.
      const conta = await this.prisma.conta.findUnique({
        where: { id: contaIdAtual() },
        select: { iaConferenciaTicket: true },
      });
      if (!conta?.iaConferenciaTicket) return;

      const viagem = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: {
          id: true,
          status: true,
          revisadoEm: true,
          ticket: true,
          toneladas: true,
          data: true,
          veiculo: { select: { placa: true } },
          cliente: { select: { nome: true } },
          material: { select: { nome: true } },
          fotos: {
            orderBy: { capturadaEm: "desc" },
            take: 1,
            select: { id: true, storageKey: true },
          },
          _count: { select: { matchesFechamento: true } },
        },
      });
      if (!viagem) return;

      const motivo = this.porQueNaoConferir(viagem);
      if (motivo) {
        this.log.debug(`Viagem ${viagemId} não entra na fila: ${motivo}`);
        return;
      }

      const foto = viagem.fotos[0];
      const placas = (
        await this.prisma.veiculo.findMany({ select: { placa: true } })
      ).map((v) => v.placa);
      const declarado: Declarado = {
        toneladas: viagem.toneladas ? Number(viagem.toneladas) : null,
        ticket: viagem.ticket,
        placa: viagem.veiculo?.placa ?? null,
        data: viagem.data,
        clienteNome: viagem.cliente?.nome ?? null,
        materialNome: viagem.material?.nome ?? null,
        // Sem isto o comparador não distingue "ticket de outro caminhão da
        // frota" de "não reconheci a placa" — e o segundo caso, que costuma ser
        // a carreta, viraria acusação.
        placasConhecidas: placas,
        // Sem peso ainda não há o que conferir nesse campo — e sem esta linha o
        // sistema acusaria TODO motorista que lançou esperando o romaneio.
        pesoConferivel:
          viagem.status !== StatusViagem.AGUARDANDO_PESO && viagem.toneladas != null,
      };

      await this.prisma.conferenciaTicket.create({
        data: {
          viagemId,
          ticketFotoId: foto.id,
          storageKey: foto.storageKey,
          viagemAtiva: viagemId,
          origem,
          declarado: declarado as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // P2002 no `viagemAtiva` é o caso normal de corrida: já existe uma
      // conferência viva pra essa viagem. Não é erro.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
      this.log.warn(`Não consegui enfileirar a conferência de ${viagemId}: ${(err as Error).message}`);
    }
  }

  /**
   * Por que esta viagem não deve ser conferida agora. `null` = pode conferir.
   *
   * Duas famílias de motivo: não há o que conferir (sem foto, viagem ainda
   * aberta), ou um humano já decidiu — e robô não passa por cima de gente.
   */
  private porQueNaoConferir(v: {
    status: StatusViagem;
    revisadoEm: Date | null;
    fotos: { id: string }[];
    _count: { matchesFechamento: number };
  }): string | null {
    if (v.fotos.length === 0) return "sem foto de ticket";
    if (v.status === StatusViagem.EM_ANDAMENTO) return "viagem ainda aberta";
    if (v.status === StatusViagem.AGUARDANDO_SAIDA) return "diária sem saída marcada";
    if (v.revisadoEm) return "um humano já conferiu";
    if (v.status === StatusViagem.DIVERGENTE || v.status === StatusViagem.OK) {
      return "já tem decisão humana no status";
    }
    if (v._count.matchesFechamento > 0) return "já entrou num fechamento";
    return null;
  }

  /**
   * Reivindica jobs pro worker. `FOR UPDATE SKIP LOCKED` deixa duas réplicas
   * puxarem da mesma fila sem pegar o mesmo item.
   *
   * SQL cru **não passa pela trava de conta**, e aqui isso é a feature: a fila é
   * da plataforma e lê de todas as contas. Cada linha traz o `contaId`, e o
   * worker abre `comConta(...)` antes de tocar em dado de negócio.
   */
  reivindicar(workerId: string, limite: number): Promise<ConferenciaTicket[]> {
    if (limite <= 0) return Promise.resolve([]);
    return comoSistema(
      () => this.prisma.$queryRaw<ConferenciaTicket[]>`
        UPDATE "conferencias_ticket"
           SET status = 'EXECUTANDO'::"StatusConferenciaTicket",
               "workerId" = ${workerId},
               "reivindicadoEm" = NOW(),
               "iniciadoEm" = COALESCE("iniciadoEm", NOW()),
               "alteradoEm" = NOW()
         WHERE id IN (
           SELECT id FROM "conferencias_ticket"
            WHERE status = 'PENDENTE'::"StatusConferenciaTicket"
              AND ("proximaTentativaEm" IS NULL OR "proximaTentativaEm" <= NOW())
            ORDER BY "criadoEm" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${limite}
         )
        RETURNING *;
      `,
    );
  }

  /**
   * Devolve pra fila jobs cuja posse ficou velha (processo morto no meio).
   *
   * `updateMany` **passa** pela trava de conta, e o worker roda sem contexto —
   * por isso o `comoSistema` explícito. A fila do agente não precisa disso
   * porque `ExecucaoAgente` está em MODELS_GLOBAIS; esta tabela não está.
   */
  async recuperarPresas(): Promise<number> {
    const limite = new Date(Date.now() - this.config.timeoutMs - 60_000);
    const { count } = await comoSistema(() =>
      this.prisma.conferenciaTicket.updateMany({
        where: { status: StatusConferenciaTicket.EXECUTANDO, reivindicadoEm: { lt: limite } },
        data: { status: StatusConferenciaTicket.PENDENTE, workerId: null, reivindicadoEm: null },
      }),
    );
    if (count > 0) this.log.warn(`Recuperada(s) ${count} conferência(s) presa(s)`);
    return count;
  }

  /** Fecha o job: libera a viagem (viagemAtiva=null) e guarda o resultado. */
  async finalizar(
    job: ConferenciaTicket,
    dados: Prisma.ConferenciaTicketUpdateInput,
  ): Promise<void> {
    const inicio = job.iniciadoEm ?? job.criadoEm;
    await this.prisma.conferenciaTicket.update({
      where: { id: job.id },
      data: {
        ...dados,
        viagemAtiva: null,
        finalizadoEm: new Date(),
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  }

  /**
   * Reagenda por falha de INFRA. Mantém `viagemAtiva` — o job continua dono da
   * viagem, então nada novo é enfileirado pra ela no meio tempo.
   */
  async reagendar(job: ConferenciaTicket, erro: string): Promise<void> {
    const tentativas = job.tentativas + 1;
    await this.prisma.conferenciaTicket.update({
      where: { id: job.id },
      data: {
        status: StatusConferenciaTicket.PENDENTE,
        tentativas,
        proximaTentativaEm: new Date(Date.now() + atrasoBackoffMs(tentativas)),
        workerId: null,
        reivindicadoEm: null,
        erro: erro.slice(0, 2_000),
      },
    });
  }

  /** Quantas segundas opiniões já foram gastas na última hora (teto de custo). */
  contarEscaladasNaHora(): Promise<number> {
    return comoSistema(() =>
      this.prisma.conferenciaTicket.count({
        where: { escalouEm: { gte: new Date(Date.now() - 3_600_000) } },
      }),
    );
  }

  /** Resumo pro painel. Roda no contexto da conta de quem pediu. */
  async resumo(): Promise<{
    aguardando: number;
    executando: number;
    ultimas24h: number;
    custoUsd24h: number;
    porVeredito: Record<string, number>;
  }> {
    const desde = new Date(Date.now() - 24 * 3_600_000);
    const [aguardando, executando, ultimas24h, agregado, grupos] = await Promise.all([
      this.prisma.conferenciaTicket.count({ where: { status: "PENDENTE" } }),
      this.prisma.conferenciaTicket.count({ where: { status: "EXECUTANDO" } }),
      this.prisma.conferenciaTicket.count({ where: { criadoEm: { gte: desde } } }),
      this.prisma.conferenciaTicket.aggregate({
        where: { criadoEm: { gte: desde } },
        _sum: { custoUsd: true },
      }),
      this.prisma.conferenciaTicket.groupBy({
        by: ["veredito"],
        where: { criadoEm: { gte: desde }, veredito: { not: null } },
        _count: true,
      }),
    ]);

    const porVeredito: Record<string, number> = {};
    for (const g of grupos) if (g.veredito) porVeredito[g.veredito] = g._count;

    return {
      aguardando,
      executando,
      ultimas24h,
      custoUsd24h: Number(agregado._sum.custoUsd ?? 0),
      porVeredito,
    };
  }

  /** Lista pro painel, mais recentes primeiro. */
  listar(limite = 50) {
    return this.prisma.conferenciaTicket.findMany({
      orderBy: { criadoEm: "desc" },
      take: Math.min(200, Math.max(1, limite)),
      select: {
        id: true,
        viagemId: true,
        status: true,
        veredito: true,
        confianca: true,
        divergencias: true,
        incertezas: true,
        declarado: true,
        leitura: true,
        acao: true,
        custoUsd: true,
        duracaoMs: true,
        passadas: true,
        modelo: true,
        erro: true,
        criadoEm: true,
        viagem: {
          select: {
            data: true,
            ticket: true,
            status: true,
            motorista: { select: { nome: true } },
          },
        },
      },
    });
  }

  /**
   * Enfileira as viagens JÁ EXISTENTES que ainda esperam conferência.
   *
   * Sem isto o conferente só valeria daqui pra frente, e o acervo pendente —
   * que é justamente o trabalho acumulado — ficaria de fora. Roda na conta de
   * quem pediu.
   *
   * O limite existe porque cada viagem custa uma leitura: mandar 5.000 de uma
   * vez é uma decisão de dinheiro, não um clique. As mais recentes primeiro,
   * que são as que ainda importam pro fechamento em aberto.
   */
  async reprocessarPendentes(limite: number): Promise<{ enfileiradas: number; candidatas: number }> {
    const conta = await this.prisma.conta.findUnique({
      where: { id: contaIdAtual() },
      select: { iaConferenciaTicket: true },
    });
    if (!conta?.iaConferenciaTicket) return { enfileiradas: 0, candidatas: 0 };

    const teto = Math.min(500, Math.max(1, limite));

    const candidatas = await this.prisma.viagem.findMany({
      where: {
        revisadoEm: null,
        status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA, StatusViagem.AGUARDANDO_PESO] },
        fotos: { some: {} },
        // Nunca reconfere o que já tem veredito: repetir leitura idêntica é
        // pagar duas vezes pela mesma resposta.
        conferenciasTicket: { none: { status: "CONCLUIDA" } },
        matchesFechamento: { none: {} },
      },
      // Mais recentes primeiro: são as que ainda importam pro fechamento aberto.
      orderBy: { sincronizadoEm: "desc" },
      take: teto,
      select: { id: true },
    });

    let enfileiradas = 0;
    for (const v of candidatas) {
      const antes = await this.prisma.conferenciaTicket.count({ where: { viagemId: v.id } });
      await this.enfileirar(v.id, "reconferencia");
      const depois = await this.prisma.conferenciaTicket.count({ where: { viagemId: v.id } });
      if (depois > antes) enfileiradas++;
    }

    this.log.log(`Reprocessamento: ${enfileiradas} de ${candidatas.length} candidata(s) na fila.`);
    return { enfileiradas, candidatas: candidatas.length };
  }

  /** Quantas viagens antigas ainda esperam conferência (pro botão do painel). */
  async contarPendentesDeConferencia(): Promise<number> {
    return this.prisma.viagem.count({
      where: {
        revisadoEm: null,
        status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA, StatusViagem.AGUARDANDO_PESO] },
        fotos: { some: {} },
        conferenciasTicket: { none: { status: "CONCLUIDA" } },
        matchesFechamento: { none: {} },
      },
    });
  }

  /** A conferência mais recente de uma viagem — pro card na tela de detalhe. */
  ultimaDaViagem(viagemId: string) {
    return this.prisma.conferenciaTicket.findFirst({
      where: { viagemId, status: "CONCLUIDA" },
      orderBy: { criadoEm: "desc" },
      select: {
        id: true,
        veredito: true,
        confianca: true,
        divergencias: true,
        incertezas: true,
        declarado: true,
        leitura: true,
        acao: true,
        passadas: true,
        criadoEm: true,
      },
    });
  }

  /**
   * Recompara conferências JÁ FEITAS, **sem chamar a IA de novo**.
   *
   * A leitura é a parte cara e ela está guardada (`leitura`), junto do que o
   * motorista declarou (`declarado`). Quem estava errado na primeira rodada foi
   * a COMPARAÇÃO — código puro. Então afinar a regra e reavaliar o acervo custa
   * zero: nenhum token é gasto aqui.
   *
   * É o que torna seguro mexer nas tolerâncias: erra, ajusta, roda de novo.
   */
  async recompararTudo(): Promise<{
    total: number;
    mudaram: number;
    porVeredito: Record<string, number>;
  }> {
    const feitas = await this.prisma.conferenciaTicket.findMany({
      where: { status: "CONCLUIDA" },
      select: { id: true, declarado: true, leitura: true, veredito: true },
    });

    let mudaram = 0;
    const porVeredito: Record<string, number> = {};

    for (const c of feitas) {
      const declarado = c.declarado as unknown as Declarado;
      const lido = c.leitura as unknown as Lido | null;
      if (!lido || typeof lido.confianca !== "number") continue;

      const r = compararDeclaradoComLido(declarado, lido);
      porVeredito[r.veredito] = (porVeredito[r.veredito] ?? 0) + 1;

      if (r.veredito !== c.veredito) {
        mudaram++;
        await this.prisma.conferenciaTicket.update({
          where: { id: c.id },
          data: {
            veredito: r.veredito,
            divergencias: r.divergencias as unknown as Prisma.InputJsonValue,
            incertezas: r.incertezas as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    this.log.log(`Recomparação: ${mudaram} de ${feitas.length} mudaram de veredito (custo zero).`);
    return { total: feitas.length, mudaram, porVeredito };
  }

  /**
   * Onde estão as divergências que sobraram, agrupadas por campo e motivo.
   *
   * Existe porque calibrar no escuro é caro: sem isto, afinar a regra vira
   * adivinhação a partir de exemplos soltos. Agrupado, um padrão que responde
   * por metade do acervo aparece na primeira olhada — foi assim que "prefixo de
   * série no ticket" apareceu como causa da maioria dos falsos positivos.
   *
   * Leitura pura e sem custo.
   */
  async diagnostico(): Promise<{
    porVeredito: Record<string, number>;
    porCampo: {
      campo: string;
      tipo: "divergencia" | "incerteza";
      quantidade: number;
      exemplos: { declarado: string; lido: string; nota?: string }[];
    }[];
  }> {
    const feitas = await this.prisma.conferenciaTicket.findMany({
      where: { status: "CONCLUIDA" },
      select: { veredito: true, divergencias: true, incertezas: true },
      take: 1000,
    });

    const porVeredito: Record<string, number> = {};
    const mapa = new Map<
      string,
      { campo: string; tipo: "divergencia" | "incerteza"; quantidade: number; exemplos: { declarado: string; lido: string; nota?: string }[] }
    >();

    const somar = (
      campo: string,
      tipo: "divergencia" | "incerteza",
      ex: { declarado: string; lido: string; nota?: string },
    ) => {
      const chave = `${tipo}:${campo}`;
      const atual = mapa.get(chave) ?? { campo, tipo, quantidade: 0, exemplos: [] };
      atual.quantidade++;
      // Poucos exemplos bastam pra reconhecer o padrão; a contagem é o que
      // diz se vale mexer na regra.
      if (atual.exemplos.length < 5) atual.exemplos.push(ex);
      mapa.set(chave, atual);
    };

    for (const c of feitas) {
      if (c.veredito) porVeredito[c.veredito] = (porVeredito[c.veredito] ?? 0) + 1;
      for (const d of (c.divergencias ?? []) as unknown as {
        campo: string;
        declarado: string;
        lido: string;
        gravidade: string;
      }[]) {
        somar(d.campo, "divergencia", { declarado: d.declarado, lido: d.lido, nota: d.gravidade });
      }
      for (const i of (c.incertezas ?? []) as unknown as {
        campo: string;
        declarado: string;
        lido: string;
        motivo: string;
      }[]) {
        somar(i.campo, "incerteza", { declarado: i.declarado, lido: i.lido, nota: i.motivo });
      }
    }

    return {
      porVeredito,
      porCampo: [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade),
    };
  }

  /** Só pra deixar explícito de qual conta é o resumo/lista (uso em log). */
  contaAtual(): string {
    return contaIdAtual();
  }

  /** Status que nunca deveriam entrar na fila — exportado pra teste. */
  static readonly STATUS_QUE_NAO_CONFEREM = STATUS_FORA_FECHAMENTO;
}
