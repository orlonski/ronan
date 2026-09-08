import { Injectable, Logger } from "@nestjs/common";
import {
  Prisma,
  StatusConferenciaTicket,
  StatusViagem,
  TipoDivergencia,
  type ConferenciaTicket,
  type VereditoConferencia,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ConferenciaConfig } from "./conferencia.config";
import { comoSistema, contaIdAtual } from "../common/conta/conta-context";
import { STATUS_FORA_FECHAMENTO } from "../common/viagem-status";
import {
  conferirComJulgamento,
  type Declarado,
  type JulgamentoIa,
  type Lido,
} from "../common/conferencia-ticket";

/**
 * Falha que o tempo resolve: a chamada não chegou ao provedor, ou ele estava
 * fora do ar. Vale uma volta na fila mais tarde.
 *
 * Deliberadamente estreita. O que não casa aqui — bug nosso, resposta fora do
 * formato, foto que sumiu — fica parado em `FALHOU`, visível na tela, esperando
 * gente decidir. Retentar um defeito de código é só gastar leitura em silêncio.
 */
export const ERRO_TRANSITORIO =
  /connection error|econnreset|econnrefused|enotfound|eai_again|epipe|socket hang up|fetch failed|network|timeout|etimedout|passou de \d+s|overloaded|rate.?limit|\b(429|500|502|503|504)\b/i;

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
 * O recorte da lista do painel. `tipo` sozinho não filtra nada: os grupos do
 * diagnóstico são sempre campo+tipo, e "só as divergências" já é o filtro por
 * veredito.
 */
export type FiltroConferencia = {
  limite?: number;
  veredito?: VereditoConferencia;
  campo?: string;
  tipo?: "divergencia" | "incerteza";
};

/** As colunas da viagem de que o `Declarado` precisa. */
export type ViagemParaDeclarado = {
  status: StatusViagem;
  ticket: string | null;
  toneladas: Prisma.Decimal | null;
  data: Date | null;
  veiculo: { placa: string } | null;
  cliente: { nome: string } | null;
  material: { nome: string } | null;
};

/** O `select` que preenche `ViagemParaDeclarado`. */
const SELECT_DECLARADO = {
  status: true,
  ticket: true,
  toneladas: true,
  data: true,
  veiculo: { select: { placa: true } },
  cliente: { select: { nome: true } },
  material: { select: { nome: true } },
} as const;

/**
 * O lado esquerdo da conferência: o que está lançado na viagem AGORA.
 *
 * Vive fora do `enfileirar` porque a reavaliação sem custo precisa montar o
 * mesmo objeto — e montar diferente dos dois lados é como o card passaria a
 * mostrar um "Lançado" que não existe mais em lugar nenhum.
 */
export function montarDeclarado(v: ViagemParaDeclarado, placasConhecidas: string[]): Declarado {
  return {
    toneladas: v.toneladas ? Number(v.toneladas) : null,
    ticket: v.ticket,
    placa: v.veiculo?.placa ?? null,
    data: v.data,
    clienteNome: v.cliente?.nome ?? null,
    materialNome: v.material?.nome ?? null,
    // Sem isto o comparador não distingue "ticket de outro caminhão da
    // frota" de "não reconheci a placa" — e o segundo caso, que costuma ser
    // a carreta, viraria acusação.
    placasConhecidas,
    // Sem peso ainda não há o que conferir nesse campo — e sem esta linha o
    // sistema acusaria TODO motorista que lançou esperando o romaneio.
    pesoConferivel: v.status !== StatusViagem.AGUARDANDO_PESO && v.toneladas != null,
  };
}

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
      const declarado = montarDeclarado(viagem, await this.placasDaFrota());

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
        // O `erro` de uma tentativa anterior morre aqui, a menos que quem
        // finaliza passe um novo. Sem esta linha, a conferência que caiu por
        // queda de conexão e deu certo na retentativa ficava para sempre com o
        // erro antigo pendurado — e a tela mostrava "Confere" com uma falha
        // vermelha embaixo, o que faz qualquer um duvidar do resultado bom.
        erro: null,
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

  /**
   * Devolve pra fila as conferências que morreram por falha TRANSITÓRIA.
   *
   * As 3 tentativas do worker cabem em ~4 minutos (30s+60s+120s de backoff).
   * Uma instabilidade de rede de dez minutos mata todo job que estiver na fila
   * naquela janela — e `FALHOU` é fim de linha: nada reenfileira sozinho, então
   * a viagem simplesmente nunca é lida e ninguém fica sabendo.
   *
   * Retentar isso não gasta nada a mais: numa falha de conexão a chamada não
   * chegou ao provedor, então a leitura que se paga aqui é a que já deveria ter
   * sido paga. O que impede o loop é `ressurreicoes`: uma volta por job, e só
   * pra erro com cara de transitório — bug nosso continua parado, visível, em
   * vez de bater de hora em hora pra sempre.
   */
  async ressuscitarFalhasDeInfra(aposMs: number): Promise<number> {
    if (aposMs <= 0) return 0;
    const agora = Date.now();
    const candidatas = await comoSistema(() =>
      this.prisma.conferenciaTicket.findMany({
        where: {
          status: StatusConferenciaTicket.FALHOU,
          ressurreicoes: 0,
          finalizadoEm: {
            lt: new Date(agora - aposMs),
            // Acervo velho não volta sozinho: se ficou um dia parado, quem
            // decide gastar é gente, pelo botão de reler.
            gt: new Date(agora - 24 * 3_600_000),
          },
          // Nada de reler o que já foi resolvido por outro caminho (o botão
          // "ler de novo", ou o reprocessamento em lote).
          viagem: {
            conferenciasTicket: { none: { status: StatusConferenciaTicket.CONCLUIDA } },
          },
        },
        orderBy: { finalizadoEm: "asc" },
        take: 50,
        select: { id: true, viagemId: true, erro: true },
      }),
    );

    let devolvidas = 0;
    for (const c of candidatas) {
      if (!ERRO_TRANSITORIO.test(c.erro ?? "")) continue;
      try {
        await comoSistema(() =>
          this.prisma.conferenciaTicket.update({
            where: { id: c.id },
            data: {
              status: StatusConferenciaTicket.PENDENTE,
              ressurreicoes: { increment: 1 },
              // Orçamento cheio de novo: a queda de rede não é culpa do job.
              tentativas: 0,
              proximaTentativaEm: null,
              workerId: null,
              reivindicadoEm: null,
              finalizadoEm: null,
              duracaoMs: null,
              // Retoma o mutex da viagem, senão um lançamento editado no meio
              // do caminho criaria um segundo job e a leitura sairia duplicada.
              viagemAtiva: c.viagemId,
            },
          }),
        );
        devolvidas++;
      } catch (err) {
        // P2002 = já existe conferência viva pra essa viagem. Ótimo: alguém
        // chegou antes, e é ela que vai ler.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        this.log.warn(`Não consegui devolver a conferência ${c.id} pra fila: ${(err as Error).message}`);
      }
    }

    if (devolvidas > 0) {
      this.log.log(`${devolvidas} conferência(s) que caíram por falha transitória voltaram pra fila.`);
    }
    return devolvidas;
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
    /**
     * Todo o acervo já lido, sem recorte de tempo. É o que diz se há o que
     * reavaliar de graça — a janela de 24h esconderia o histórico antigo, que é
     * justamente o que se quer recomparar quando a regra fica mais esperta.
     */
    concluidas: number;
    custoUsd24h: number;
    porVeredito: Record<string, number>;
  }> {
    const desde = new Date(Date.now() - 24 * 3_600_000);
    const [aguardando, executando, ultimas24h, concluidas, agregado, grupos] = await Promise.all([
      this.prisma.conferenciaTicket.count({ where: { status: "PENDENTE" } }),
      this.prisma.conferenciaTicket.count({ where: { status: "EXECUTANDO" } }),
      this.prisma.conferenciaTicket.count({ where: { criadoEm: { gte: desde } } }),
      this.prisma.conferenciaTicket.count({ where: { status: "CONCLUIDA" } }),
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
      concluidas,
      custoUsd24h: Number(agregado._sum.custoUsd ?? 0),
      porVeredito,
    };
  }

  /**
   * Lista pro painel, mais recentes primeiro — com o mesmo recorte que o
   * diagnóstico usa pra agrupar.
   *
   * O filtro por campo existe porque agrupar sem deixar abrir é meio caminho:
   * a tela dizia "placa: 23x" e a única saída era rolar a lista inteira
   * procurando quais eram. `array_contains` vira `@>` no jsonb, que faz
   * containment PARCIAL dentro do array — casa `{campo}` sem precisar
   * reproduzir o objeto inteiro da divergência.
   */
  listar(f: FiltroConferencia = {}) {
    const where: Prisma.ConferenciaTicketWhereInput = {};
    if (f.veredito) where.veredito = f.veredito;

    if (f.campo) {
      const naDivergencia = { divergencias: { array_contains: [{ campo: f.campo }] } };
      const naIncerteza = { incertezas: { array_contains: [{ campo: f.campo }] } };
      // Sem tipo, o campo vale nos dois lados: quem clica em "placa" quer as
      // conferências que falam de placa, não uma metade delas.
      if (f.tipo === "divergencia") Object.assign(where, naDivergencia);
      else if (f.tipo === "incerteza") Object.assign(where, naIncerteza);
      else where.OR = [naDivergencia, naIncerteza];
    }

    return this.prisma.conferenciaTicket.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      take: Math.min(200, Math.max(1, f.limite ?? 50)),
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

  /**
   * O que aconteceu com a leitura desta viagem — pro card na tela de detalhe.
   *
   * Devolve a última leitura CONCLUÍDA (que é o que o card compara campo a
   * campo) e, junto, o que a viagem não conseguia contar antes: que tem leitura
   * na fila agora, que a última tentativa caiu, e o histórico das tentativas.
   *
   * Isso existe porque antes daqui só saía conferência concluída — então uma
   * viagem cuja leitura falhou não mostrava card nenhum. Quem abria a viagem
   * via a mesma tela de quem nunca teve conferência, sem jeito de saber que
   * houve tentativa, e sem o botão de mandar ler de novo.
   *
   * `desatualizada`: o `declarado` é o congelado no enfileiramento, e quem
   * edita a viagem depois via o card teimar no valor velho sem entender por
   * quê. O flag é o que deixa a tela oferecer a reavaliação em vez de mostrar
   * uma comparação que não vale mais.
   */
  async ultimaDaViagem(viagemId: string) {
    const historico = await this.prisma.conferenciaTicket.findMany({
      where: { viagemId },
      orderBy: { criadoEm: "desc" },
      // Teto pra viagem que já foi relida muitas vezes não virar payload grande
      // — o card mostra a linha do tempo, não uma auditoria completa.
      take: 10,
      select: {
        id: true,
        status: true,
        veredito: true,
        confianca: true,
        divergencias: true,
        incertezas: true,
        declarado: true,
        leitura: true,
        acao: true,
        passadas: true,
        modelo: true,
        origem: true,
        tentativas: true,
        ressurreicoes: true,
        erro: true,
        criadoEm: true,
        finalizadoEm: true,
        duracaoMs: true,
      },
    });
    if (historico.length === 0) return null;

    const concluida = historico.find((h) => h.status === "CONCLUIDA") ?? null;
    const naFila =
      historico.find((h) => h.status === "PENDENTE" || h.status === "EXECUTANDO") ?? null;
    // Só interessa a falha que veio DEPOIS da última leitura boa: uma queda de
    // conexão antes de um resultado bem-sucedido é história, não pendência.
    const falha =
      historico.find(
        (h) =>
          h.status === "FALHOU" && (!concluida || h.criadoEm.getTime() > concluida.criadoEm.getTime()),
      ) ?? null;

    let desatualizada = false;
    if (concluida) {
      const viagem = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: SELECT_DECLARADO,
      });
      const congelado = concluida.declarado as unknown as Declarado | null;
      desatualizada = !!viagem && !!congelado && !mesmoLancamento(congelado, viagem);
    }

    return {
      // A leitura que vale. Tudo null quando ainda não houve nenhuma completa —
      // e aí é `naFila`/`falha` que contam a história.
      id: concluida?.id ?? null,
      veredito: concluida?.veredito ?? null,
      confianca: concluida?.confianca ?? null,
      divergencias: concluida?.divergencias ?? null,
      incertezas: concluida?.incertezas ?? null,
      declarado: concluida?.declarado ?? null,
      leitura: concluida?.leitura ?? null,
      acao: concluida?.acao ?? null,
      passadas: concluida?.passadas ?? 0,
      criadoEm: concluida?.criadoEm ?? historico[0].criadoEm,
      desatualizada,
      naFila: naFila && {
        status: naFila.status,
        tentativas: naFila.tentativas,
        criadoEm: naFila.criadoEm,
      },
      falha: falha && {
        erro: falha.erro,
        tentativas: falha.tentativas,
        ressuscitavel: falha.ressurreicoes === 0 && ERRO_TRANSITORIO.test(falha.erro ?? ""),
        finalizadoEm: falha.finalizadoEm,
      },
      historico: historico.map((h) => ({
        id: h.id,
        status: h.status,
        veredito: h.veredito,
        confianca: h.confianca,
        origem: h.origem,
        erro: h.erro,
        modelo: h.modelo,
        passadas: h.passadas,
        duracaoMs: h.duracaoMs,
        criadoEm: h.criadoEm,
        finalizadoEm: h.finalizadoEm,
      })),
    };
  }

  /** As placas da frota, pro comparador saber o que é caminhão de casa. */
  private async placasDaFrota(): Promise<string[]> {
    const veiculos = await this.prisma.veiculo.findMany({ select: { placa: true } });
    return veiculos.map((v) => v.placa);
  }

  /**
   * Reavalia UMA viagem com a regra de hoje, **sem chamar a IA**.
   *
   * O que muda em relação ao lote: o lado esquerdo é remontado a partir da
   * viagem AGORA, não do snapshot do enfileiramento. É o que faz "corrigi o
   * lançamento e reavaliei" dar o resultado que a pessoa espera — comparar
   * contra o valor velho responderia uma pergunta que ninguém fez.
   */
  async recompararViagem(viagemId: string): Promise<{
    recomparada: boolean;
    motivo?: string;
    veredito?: string;
    mudou?: boolean;
    reverteu?: boolean;
  }> {
    const c = await this.prisma.conferenciaTicket.findFirst({
      where: { viagemId, status: "CONCLUIDA" },
      orderBy: { criadoEm: "desc" },
      select: { id: true, viagemId: true, leitura: true, veredito: true, acao: true },
    });
    if (!c) return { recomparada: false, motivo: "esta viagem ainda não foi lida" };

    const r = await this.recompararUma(c, await this.placasDaFrota());
    if (!r) return { recomparada: false, motivo: "a leitura guardada não serve pra comparar" };
    return { recomparada: true, ...r };
  }

  /**
   * O miolo da reavaliação: recompara e, quando o veredito melhora, desfaz o
   * que o robô tinha feito com a viagem.
   */
  private async recompararUma(
    c: { id: string; viagemId: string; leitura: unknown; veredito: string | null; acao: string | null },
    placas: string[],
  ): Promise<{ veredito: string; mudou: boolean; reverteu: boolean } | null> {
    const lido = c.leitura as unknown as Lido | null;
    if (!lido || typeof lido.confianca !== "number") return null;

    const viagem = await this.prisma.viagem.findUnique({
      where: { id: c.viagemId },
      select: SELECT_DECLARADO,
    });
    if (!viagem) return null;
    const declarado = montarDeclarado(viagem, placas);

    // O julgamento da IA foi guardado junto da leitura, então recomparar
    // continua custando zero mesmo com a decisão sendo semântica.
    const julgamento = (lido as unknown as { julgamento?: JulgamentoIa }).julgamento ?? {};
    const r = conferirComJulgamento(declarado, lido, julgamento);
    const mudou = r.veredito !== c.veredito;

    await this.prisma.conferenciaTicket.update({
      where: { id: c.id },
      data: {
        veredito: r.veredito,
        divergencias: r.divergencias as unknown as Prisma.InputJsonValue,
        incertezas: r.incertezas as unknown as Prisma.InputJsonValue,
        // O snapshot acompanha: é o que o card mostra como "Lançado", e depois
        // de reavaliar ele tem que falar do lançamento que foi comparado.
        declarado: declarado as unknown as Prisma.InputJsonValue,
      },
    });

    const reverteu = mudou ? await this.desfazerAcao(c, r.veredito) : false;
    return { veredito: r.veredito, mudou, reverteu };
  }

  /**
   * Devolve a viagem ao estado anterior quando a regra nova diz que estava
   * tudo certo.
   *
   * Sem isto a correção de uma regra não tem efeito nenhum: o veredito na
   * tabela muda, a viagem segue parada em "Em conferência" e quem clicou em
   * reavaliar conclui, com razão, que não funcionou.
   *
   * Três travas: só desfaz quando o novo veredito é benigno, só toca no status
   * que o próprio robô escreveu, e nunca em viagem com `revisadoEm` — decisão
   * de gente não se desfaz sozinha. `PEDIU_FOTO` fica de fora de propósito:
   * foto ilegível não é matéria de regra, é de foto.
   */
  private async desfazerAcao(
    c: { viagemId: string; acao: string | null },
    veredito: string,
  ): Promise<boolean> {
    if (veredito !== "BATE" && veredito !== "NAO_APLICAVEL") return false;

    const de =
      c.acao === "FILA_REVISAO"
        ? StatusViagem.EM_CONFERENCIA
        : c.acao === "AVISOU_MOTORISTA"
          ? StatusViagem.DIVERGENTE
          : null;
    if (!de) return false;

    const alterou = await this.prisma.viagem.updateMany({
      where: {
        id: c.viagemId,
        status: de,
        revisadoEm: null,
        // Divergência de foto ilegível tem outro dono: o motorista, que já foi
        // chamado pra mandar outra. Não se desfaz por trás dele.
        ...(de === StatusViagem.DIVERGENTE
          ? { tipoDivergencia: { not: TipoDivergencia.FOTO_ILEGIVEL } }
          : {}),
      },
      data: { status: StatusViagem.ENVIADA, motivoStatus: null, tipoDivergencia: null },
    });
    if (alterou.count === 0) return false;

    try {
      await this.prisma.viagemMensagem.create({
        data: {
          viagemId: c.viagemId,
          autor: "ADMIN",
          usuarioId: null,
          autorNome: "Conferência automática",
          texto:
            "Reavaliei esta leitura com a regra de hoje e o documento confere. " +
            "A viagem voltou pra fila normal, sem custo de leitura nova.",
          acao: "CONFERIU",
        },
      });
    } catch {
      /* o registro no chat é conveniência; a reversão já está gravada */
    }
    await this.prisma.conferenciaTicket.updateMany({
      where: { viagemId: c.viagemId, status: "CONCLUIDA" },
      data: { acao: "REVERTEU_REVISAO", aplicadoEm: new Date() },
    });
    return true;
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
    /** Quantas viagens o robô tinha mexido e agora devolveu ao estado normal. */
    reverteram: number;
    porVeredito: Record<string, number>;
  }> {
    const feitas = await this.prisma.conferenciaTicket.findMany({
      where: { status: "CONCLUIDA" },
      select: { id: true, viagemId: true, leitura: true, veredito: true, acao: true },
    });

    // As placas da frota são as mesmas pra todas: uma consulta, não uma por
    // conferência.
    const placas = await this.placasDaFrota();

    let mudaram = 0;
    let reverteram = 0;
    const porVeredito: Record<string, number> = {};

    for (const c of feitas) {
      const r = await this.recompararUma(c, placas);
      if (!r) continue;
      porVeredito[r.veredito] = (porVeredito[r.veredito] ?? 0) + 1;
      if (r.mudou) mudaram++;
      if (r.reverteu) reverteram++;
    }

    this.log.log(
      `Recomparação: ${mudaram} de ${feitas.length} mudaram de veredito, ` +
        `${reverteram} viagem(ns) saíram da revisão (custo zero).`,
    );
    return { total: feitas.length, mudaram, reverteram, porVeredito };
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

  /**
   * Manda ler de novo a foto de uma viagem.
   *
   * Serve pro caso em que quem confere olha a foto, vê que está boa, e a
   * leitura não deu certo assim mesmo. Sem isto o único caminho seria pedir
   * foto nova ao motorista por um problema que não é dele.
   *
   * Custa uma leitura, então é ação de gente clicando — não entra sozinha.
   */
  async relerViagem(viagemId: string): Promise<{ enfileirada: boolean; motivo?: string }> {
    const conta = await this.prisma.conta.findUnique({
      where: { id: contaIdAtual() },
      select: { iaConferenciaTicket: true },
    });
    if (!conta?.iaConferenciaTicket) {
      return { enfileirada: false, motivo: "A conferência não está liberada para esta empresa." };
    }

    const ativa = await this.prisma.conferenciaTicket.findFirst({
      where: { viagemId, viagemAtiva: { not: null } },
      select: { id: true },
    });
    if (ativa) return { enfileirada: false, motivo: "Já tem uma leitura em andamento pra essa viagem." };

    const antes = await this.prisma.conferenciaTicket.count({ where: { viagemId } });
    await this.enfileirar(viagemId, "reconferencia");
    const depois = await this.prisma.conferenciaTicket.count({ where: { viagemId } });

    return depois > antes
      ? { enfileirada: true }
      : { enfileirada: false, motivo: "Essa viagem não está em estado de ser conferida agora." };
  }

  /** Só pra deixar explícito de qual conta é o resumo/lista (uso em log). */
  contaAtual(): string {
    return contaIdAtual();
  }

  /** Status que nunca deveriam entrar na fila — exportado pra teste. */
  static readonly STATUS_QUE_NAO_CONFEREM = STATUS_FORA_FECHAMENTO;
}

/**
 * O lançamento ainda é o que estava lançado quando a leitura foi comparada?
 *
 * Só os campos que entram na conferência — mexer no km ou no pedágio não torna
 * a leitura do ticket obsoleta.
 */
function mesmoLancamento(congelado: Declarado, v: ViagemParaDeclarado): boolean {
  const dia = (d: Date | string | null | undefined) =>
    d ? (typeof d === "string" ? d : d.toISOString()).slice(0, 10) : null;
  return (
    (congelado.ticket ?? null) === (v.ticket ?? null) &&
    Number(congelado.toneladas ?? 0) === Number(v.toneladas ?? 0) &&
    (congelado.placa ?? null) === (v.veiculo?.placa ?? null) &&
    dia(congelado.data) === dia(v.data) &&
    (congelado.clienteNome ?? null) === (v.cliente?.nome ?? null) &&
    (congelado.materialNome ?? null) === (v.material?.nome ?? null)
  );
}
