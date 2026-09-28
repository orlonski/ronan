import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { comLockDeCron } from "../common/cron-exclusivo";
import { STATUS_FORA_FECHAMENTO } from "../common/viagem-status";
import { SdrService } from "../sdr/sdr.service";
import { AtendimentoHumanoService } from "../sdr/atendimento-humano.service";
import {
  lembreteDoTeste,
  primeiroNome,
  testePasso2,
  type ProgressoTeste,
} from "../sdr/roteiro-comercial";
import { ChatwootClientService } from "./chatwoot-client.service";

/** Prefixo do `clientId` da viagem importada (`importacao.service.ts`). */
const PREFIXO_IMPORTACAO = "import:";

/**
 * A Meta só aceita texto livre até 24h depois da última mensagem DELE. Com
 * folga, pra o envio não cair na borda.
 */
const JANELA_META_MS = 22 * 3_600_000;

/** Quanto esperar, depois do link, antes do único lembrete. */
const ESPERA_LEMBRETE_MS = 3 * 3_600_000;

/**
 * O robô acompanha o teste de quem escolheu testar.
 *
 * O dono, 28/09/2026: "e daí? depois? morre nisso a conversa?". O link do
 * teste solto era o fim do atendimento. Agora:
 *
 * - A conta nasce com o telefone da conversa (`cadastro-conta` grava
 *   `Lead.contaId`) → o robô manda o que cadastrar, na ordem do painel, sem
 *   ninguém pedir. É a promessa do passo 1 ("assim que a conta for criada, eu te
 *   mando aqui"), e ela só pode ser feita porque isto existe.
 * - Pegou o link e sumiu sem criar a conta → UM lembrete, 3h depois, em horário
 *   de atendimento. Nunca dois: o dono pediu que o robô não force.
 *
 * Nada sai fora da janela de 24h da Meta, nem com gente na conversa, nem com o
 * robô desligado.
 */
@Injectable()
export class TesteGuiadoService {
  private readonly log = new Logger("TesteGuiado");

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatwoot: ChatwootClientService,
    private readonly sdr: SdrService,
    private readonly atendimento: AtendimentoHumanoService,
  ) {}

  /** O que a conta já tem, espelhando os passos do painel. `null` = conta não existe mais. */
  async progresso(contaId: string): Promise<ProgressoTeste | null> {
    const existe = await comoSistema(() =>
      this.prisma.conta.findUnique({ where: { id: contaId }, select: { id: true } }),
    );
    if (!existe) return null;
    return comConta(contaId, async () => {
      const [veiculos, locais, clientes, motoristas, viagens] = await Promise.all([
        this.prisma.veiculo.count({ take: 1 }),
        this.prisma.local.count({ take: 2 }),
        this.prisma.cliente.count({ take: 1 }),
        this.prisma.motorista.count({ take: 1 }),
        this.prisma.viagem.count({
          where: {
            status: { notIn: STATUS_FORA_FECHAMENTO },
            NOT: { clientId: { startsWith: PREFIXO_IMPORTACAO } },
          },
          take: 1,
        }),
      ]);
      return {
        veiculo: veiculos > 0,
        // Dois: a viagem exige local de carga E de descarga.
        locais: locais > 1,
        cliente: clientes > 0,
        motorista: motoristas > 0,
        viagem: viagens > 0,
      };
    });
  }

  /**
   * O passo 2 pra este lead: com o progresso real quando a conta é conhecida,
   * ou a lista inteira quando ele diz que criou e a conta não casou (usou outro
   * telefone no cadastro).
   */
  async textoDoPasso2(leadId: string): Promise<string> {
    const lead = await comoSistema(() =>
      this.prisma.lead.findUnique({ where: { id: leadId }, select: { contaId: true } }),
    );
    const progresso = lead?.contaId ? await this.progresso(lead.contaId) : null;
    return testePasso2(progresso, Boolean(progresso));
  }

  /** Marca que o passo 2 saiu (a guia é uma por conversa). */
  async marcarGuia(leadId: string): Promise<void> {
    await comoSistema(() =>
      this.prisma.lead.update({ where: { id: leadId }, data: { testeGuiaEm: new Date() } }),
    );
  }

  /** Marca que o passo 1 (o link) saiu. */
  async marcarOferecido(leadId: string): Promise<void> {
    await comoSistema(() =>
      this.prisma.lead.update({
        where: { id: leadId },
        data: { testeOferecidoEm: new Date(), testeGuiaEm: null, testeLembreteEm: null },
      }),
    );
  }

  /** Em que ponto do teste este lead está. */
  async etapa(leadId: string): Promise<{ oferecido: boolean; guiado: boolean; comConta: boolean }> {
    const lead = await comoSistema(() =>
      this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { testeOferecidoEm: true, testeGuiaEm: true, contaId: true },
      }),
    );
    return {
      oferecido: Boolean(lead?.testeOferecidoEm),
      guiado: Boolean(lead?.testeGuiaEm),
      comConta: Boolean(lead?.contaId),
    };
  }

  /** A cada 2 minutos: conta criada → guia; link parado → lembrete. */
  @Cron("0 */2 * * * *", { name: "sdr-teste-guiado", timeZone: "America/Sao_Paulo" })
  async varrer(): Promise<void> {
    await comLockDeCron(this.prisma, "sdr-teste-guiado", async () => {
      try {
        if (!(await this.sdr.ativo())) return;
        await this.guiarContasNovas();
        await this.lembrarQuemSumiu();
      } catch (e) {
        this.log.error(`falha na varredura: ${(e as Error).message}`);
      }
    });
  }

  private async guiarContasNovas(agora = new Date()): Promise<void> {
    const leads = await comoSistema(() =>
      this.prisma.lead.findMany({
        where: {
          testeOferecidoEm: { not: null },
          testeGuiaEm: null,
          contaId: { not: null },
          sdrPausadoEm: null,
          optOut: false,
          chatwootConversaId: { not: null },
          chatwootContaId: { not: null },
        },
        select: { id: true, chatwootContaId: true, chatwootConversaId: true },
        take: 20,
      }),
    );
    for (const lead of leads) {
      if (!(await this.dentroDaJanela(lead.id, agora))) continue;
      // Marca ANTES de enviar: duas réplicas do cron não mandam duas vezes.
      const marcado = await comoSistema(() =>
        this.prisma.lead.updateMany({
          where: { id: lead.id, testeGuiaEm: null },
          data: { testeGuiaEm: agora },
        }),
      );
      if (marcado.count === 0) continue;
      const texto = await this.textoDoPasso2(lead.id);
      if (await this.chatwoot.responder(lead.chatwootContaId!, lead.chatwootConversaId!, texto)) {
        await this.sdr.registrarSaida(lead.id, texto);
        this.log.log(`conta criada pelo lead ${lead.id}: guia do teste enviada`);
      }
    }
  }

  private async lembrarQuemSumiu(agora = new Date()): Promise<void> {
    if (!(await this.atendimento.dentroDoHorarioAgora())) return;
    const leads = await comoSistema(() =>
      this.prisma.lead.findMany({
        where: {
          testeOferecidoEm: { not: null, lte: new Date(agora.getTime() - ESPERA_LEMBRETE_MS) },
          testeGuiaEm: null,
          testeLembreteEm: null,
          contaId: null,
          sdrPausadoEm: null,
          optOut: false,
          chatwootConversaId: { not: null },
          chatwootContaId: { not: null },
        },
        select: { id: true, nome: true, chatwootContaId: true, chatwootConversaId: true, testeOferecidoEm: true },
        take: 20,
      }),
    );
    for (const lead of leads) {
      if (!(await this.dentroDaJanela(lead.id, agora))) continue;
      // Ele escreveu depois do link: a conversa está viva, e quem responde é o
      // atendimento normal, não um lembrete.
      const falouDepois = await comoSistema(() =>
        this.prisma.mensagemLead.count({
          where: { leadId: lead.id, direcao: "ENTRADA", criadoEm: { gt: lead.testeOferecidoEm! } },
        }),
      );
      if (falouDepois > 0) continue;
      const marcado = await comoSistema(() =>
        this.prisma.lead.updateMany({
          where: { id: lead.id, testeLembreteEm: null },
          data: { testeLembreteEm: agora },
        }),
      );
      if (marcado.count === 0) continue;
      const texto = lembreteDoTeste(primeiroNome(lead.nome));
      if (await this.chatwoot.responder(lead.chatwootContaId!, lead.chatwootConversaId!, texto)) {
        await this.sdr.registrarSaida(lead.id, texto);
        this.log.log(`lembrete do teste enviado ao lead ${lead.id}`);
      }
    }
  }

  /** A última mensagem DELE ainda está dentro da janela de texto livre da Meta? */
  private async dentroDaJanela(leadId: string, agora: Date): Promise<boolean> {
    const ultima = await comoSistema(() =>
      this.prisma.mensagemLead.findFirst({
        where: { leadId, direcao: "ENTRADA" },
        orderBy: { criadoEm: "desc" },
        select: { criadoEm: true },
      }),
    );
    return Boolean(ultima && agora.getTime() - ultima.criadoEm.getTime() < JANELA_META_MS);
  }
}
