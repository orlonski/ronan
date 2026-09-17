import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { comoSistema } from "../common/conta/conta-context";
import { comLockDeCron } from "../common/cron-exclusivo";
import { PrismaService } from "../prisma/prisma.service";
import {
  acaoDoFollowup,
  type AcaoFollowup,
  type EstadoConversa,
  type PrazosFollowup,
} from "./followup.regua";

/**
 * O varredor das conversas que pararam.
 *
 * **Hoje ele não manda nada.** Roda, decide e conta o que teria feito — a
 * cadência real aparece antes de a primeira mensagem existir. Ligar envio
 * automático pra prospect sem saber quantas mensagens por dia isso significa é
 * a forma mais rápida de descobrir o volume pelo número bloqueado.
 *
 * Mora no processo da API porque `ScheduleModule.forRoot()` só existe em
 * `app.module.ts`; o worker do agente não importa nem o SdrModule nem o cliente
 * do Chatwoot, e movê-lo pra lá significaria remontar meia árvore de
 * dependências num processo cuja função é a fila de execuções.
 */

/** Quantas conversas a varredura olha por vez. Teto pra não varrer a base toda. */
const LOTE = 500;

export type Previsao = {
  /** Conversas com mensagem, vivas, que entraram na conta. */
  analisadas: number;
  /** O que sairia AGORA, se o envio estivesse ligado. */
  cobrariam: number;
  /** O que seria dado por encerrado. */
  encerrariam: number;
  /** Barradas pela janela de 24h da Meta — nunca poderiam receber texto livre. */
  foraDaJanela: number;
  /** Gente que escreveu e não foi respondida. O robô não toca; uma pessoa tem que ver. */
  esperandoResposta: number;
  /** Quem seria cobrado, pra conferir na tela antes de ligar qualquer coisa. */
  exemplos: { empresa: string; horasParadas: number; passo: number }[];
  /** Quando esta conta foi feita. */
  em: Date;
};

type LinhaLead = {
  id: string;
  empresa: string;
  optOut: boolean;
  status: string;
  followupsEnviados: number;
  ultimoFollowupEm: Date | null;
  conversaEncerradaEm: Date | null;
  sdrPausadoEm: Date | null;
};

type LinhaMensagem = { leadId: string; direcao: string; criadoEm: Date };

@Injectable()
export class FollowupService {
  private readonly log = new Logger("SdrFollowup");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * De 15 em 15 minutos, em horário comercial.
   *
   * A régua decide em horas; 15 minutos é granularidade de sobra e mantém o
   * custo perto de zero. `timeZone` explícito porque o container roda em UTC —
   * sem isso, "9 às 19" seria das 6 às 16 em São Paulo.
   */
  @Cron("0 */15 9-19 * * 1-6", { name: "sdr-followup", timeZone: "America/Sao_Paulo" })
  async varrer(): Promise<void> {
    await comLockDeCron(this.prisma, "sdr-followup", async () => {
      try {
        const p = await this.prever();
        // Só fala quando tem o que dizer: varredura silenciosa toda quinze
        // minutos vira ruído e esconde o dia em que algo acontecer.
        if (p.cobrariam > 0 || p.encerrariam > 0 || p.esperandoResposta > 0) {
          this.log.log(
            `modo seco — ${p.analisadas} conversa(s): ${p.cobrariam} seriam cobradas, ` +
              `${p.encerrariam} encerrariam, ${p.foraDaJanela} fora da janela da Meta, ` +
              `${p.esperandoResposta} esperando resposta NOSSA (nenhuma mensagem foi enviada).`,
          );
        }
      } catch (e) {
        // Cron não derruba o processo que também serve o app do motorista.
        this.log.error(`falha na varredura: ${(e as Error).message}`);
      }
    });
  }

  /**
   * O que aconteceria se o envio estivesse ligado agora.
   *
   * É isto que a tela mostra. O log do servidor não serve pra essa resposta: o
   * painel do Easypanel guarda poucas linhas e o boot do Nest enche o buffer,
   * então o que se vê lá é o boot, não o que aconteceu depois.
   */
  async prever(agora = new Date()): Promise<Previsao> {
    const prazos = await this.prazos();

    const leads = await comoSistema(() =>
      this.prisma.lead.findMany({
        where: {
          conversaEncerradaEm: null,
          optOut: false,
          // Quem já tem dono humano ou virou cliente não entra na conta.
          status: { notIn: ["GANHOU", "PERDEU", "QUALIFICADO", "PROPOSTA"] },
          sdrPausadoEm: null,
          // Só quem tem conversa: a base tem 24 mil leads e a esmagadora
          // maioria nunca trocou uma mensagem.
          mensagens: { some: {} },
        },
        select: {
          id: true,
          empresa: true,
          optOut: true,
          status: true,
          followupsEnviados: true,
          ultimoFollowupEm: true,
          conversaEncerradaEm: true,
          sdrPausadoEm: true,
        },
        take: LOTE,
      }),
    );

    const p: Previsao = {
      analisadas: leads.length,
      cobrariam: 0,
      encerrariam: 0,
      foraDaJanela: 0,
      esperandoResposta: 0,
      exemplos: [],
      em: agora,
    };
    if (leads.length === 0) return p;

    const { ultimas, entradas } = await this.mensagensDe(leads.map((l) => l.id));

    for (const lead of leads as LinhaLead[]) {
      const ultima = ultimas.get(lead.id);
      const c: EstadoConversa = {
        ultimaDirecao: (ultima?.direcao as "ENTRADA" | "SAIDA" | undefined) ?? null,
        ultimaMensagemEm: ultima?.criadoEm ?? null,
        ultimaEntradaEm: entradas.get(lead.id) ?? null,
        followupsEnviados: lead.followupsEnviados,
        ultimoFollowupEm: lead.ultimoFollowupEm,
        conversaEncerradaEm: lead.conversaEncerradaEm,
        sdrPausadoEm: lead.sdrPausadoEm,
        optOut: lead.optOut,
        status: lead.status,
      };

      const acao: AcaoFollowup = acaoDoFollowup(c, prazos, agora);
      const horas = c.ultimaMensagemEm
        ? (agora.getTime() - c.ultimaMensagemEm.getTime()) / 3_600_000
        : 0;

      if (acao.tipo === "FOLLOWUP") {
        p.cobrariam++;
        if (p.exemplos.length < 10) {
          p.exemplos.push({ empresa: lead.empresa, horasParadas: horas, passo: acao.passo });
        }
      } else if (acao.tipo === "ENCERRAR") {
        p.encerrariam++;
        if (acao.motivo === "janela-da-meta-fechada") p.foraDaJanela++;
      } else if (acao.motivo === "ele-falou-por-ultimo") {
        // Não é caso de robô, é caso de gente: alguém escreveu e não teve
        // resposta. Conta à parte justamente pra isso não se perder no meio.
        p.esperandoResposta++;
      }
    }
    return p;
  }

  /** A última mensagem e a última ENTRADA de cada lead, em duas consultas. */
  private async mensagensDe(ids: string[]) {
    const ultimas = await this.prisma.$queryRaw<LinhaMensagem[]>`
      SELECT DISTINCT ON ("leadId") "leadId", "direcao", "criadoEm"
      FROM "mensagens_lead"
      WHERE "leadId" = ANY(${ids})
      ORDER BY "leadId", "criadoEm" DESC
    `;
    const entradas = await this.prisma.$queryRaw<{ leadId: string; criadoEm: Date }[]>`
      SELECT DISTINCT ON ("leadId") "leadId", "criadoEm"
      FROM "mensagens_lead"
      WHERE "leadId" = ANY(${ids}) AND "direcao" = 'ENTRADA'
      ORDER BY "leadId", "criadoEm" DESC
    `;
    return {
      ultimas: new Map(ultimas.map((r) => [r.leadId, r])),
      entradas: new Map(entradas.map((r) => [r.leadId, r.criadoEm])),
    };
  }

  private async prazos(): Promise<PrazosFollowup> {
    const cfg = await comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({
        where: { id: "singleton" },
        select: {
          sdrFollowupHoras: true,
          sdrFollowupMax: true,
          sdrFollowupIntervaloHoras: true,
          sdrEncerrarAposHoras: true,
          sdrFollowupHoraInicio: true,
          sdrFollowupHoraFim: true,
        },
      }),
    );
    return {
      followupHoras: cfg?.sdrFollowupHoras ?? 4,
      followupMax: cfg?.sdrFollowupMax ?? 2,
      followupIntervaloHoras: cfg?.sdrFollowupIntervaloHoras ?? 18,
      encerrarAposHoras: cfg?.sdrEncerrarAposHoras ?? 48,
      horaInicio: cfg?.sdrFollowupHoraInicio ?? 9,
      horaFim: cfg?.sdrFollowupHoraFim ?? 19,
    };
  }
}
