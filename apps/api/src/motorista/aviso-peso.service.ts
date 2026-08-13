import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import { EvolutionClientService } from "../whatsapp/evolution-client.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { paraCadaConta } from "../common/conta/para-cada-conta";

/**
 * Avisos pro motorista não esquecer de completar o peso/romaneio de uma viagem
 * lançada em AGUARDANDO_PESO. Dois momentos:
 *  1. Na criação (avisarViagemAguardandoPeso): push + WhatsApp "lançou sem peso".
 *  2. No fim do dia (cron lembreteFimDoDia): push + WhatsApp com o resumo das
 *     que ainda faltam — só pra quem tem pendência.
 *
 * Tudo best-effort: falha de push/WhatsApp nunca derruba o fluxo que disparou.
 */
@Injectable()
export class AvisoPesoService {
  private readonly log = new Logger("AvisoPesoService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly evolution: EvolutionClientService,
  ) {}

  /** Aviso na criação de uma viagem sem peso. */
  async avisarViagemAguardandoPeso(
    viagemId: string,
    motoristaId: string,
  ): Promise<void> {
    try {
      const viagem = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: {
          cliente: { select: { nome: true } },
          motorista: {
            select: {
              expoPushToken: true,
              telefone: true,
              nome: true,
              aceitaWhatsapp: true,
            },
          },
        },
      });
      if (!viagem) return;

      const cliente = viagem.cliente?.nome ?? "";
      const corpo = cliente
        ? `Você lançou a viagem pra ${cliente} sem o peso. Quando sair o romaneio, abra o app e complete o peso e o ticket.`
        : `Você lançou uma viagem sem o peso. Quando sair o romaneio, abra o app e complete o peso e o ticket.`;

      await this.enviarPush(
        motoristaId,
        viagem.motorista?.expoPushToken,
        "Falta o peso dessa viagem",
        corpo,
        { viagemId, rota: "aguardando-peso" },
      );
      if (viagem.motorista?.aceitaWhatsapp !== false) {
        await this.enviarWhatsapp(
          viagem.motorista?.telefone,
          `⚖️ *Falta o peso da viagem*\n\n${corpo}`,
        );
      }
    } catch (err) {
      this.log.warn(
        `avisarViagemAguardandoPeso(${viagemId}) falhou: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Lembrete no fim do dia: pra cada motorista com viagens AGUARDANDO_PESO em
   * aberto, manda push + WhatsApp com o resumo. Roda 18:00 (horário de Brasília).
   */
  @Cron("0 0 18 * * *", {
    name: "lembrete-aguardando-peso",
    timeZone: "America/Sao_Paulo",
  })
  async lembreteFimDoDia(): Promise<void> {
    // Cobra viagem sem peso de cada empresa; o texto e a lista são dela.
    await paraCadaConta(this.prisma, () => this.lembreteFimDoDiaDaVez());
  }

  private async lembreteFimDoDiaDaVez(): Promise<void> {
    const pendentes = await this.prisma.viagem.findMany({
      where: { status: "AGUARDANDO_PESO" },
      select: {
        id: true,
        data: true,
        motoristaId: true,
        cliente: { select: { nome: true } },
        localDescarga: { select: { nome: true } },
        motorista: {
          select: { expoPushToken: true, telefone: true, aceitaWhatsapp: true },
        },
      },
      orderBy: { data: "asc" },
    });
    if (pendentes.length === 0) return;

    // Agrupa por motorista.
    const porMotorista = new Map<string, typeof pendentes>();
    for (const v of pendentes) {
      const lista = porMotorista.get(v.motoristaId) ?? [];
      lista.push(v);
      porMotorista.set(v.motoristaId, lista);
    }

    for (const [motoristaId, viagens] of porMotorista) {
      const n = viagens.length;
      const plural = n === 1 ? "viagem" : "viagens";
      const titulo = `Você tem ${n} ${plural} sem peso`;
      const corpo = `Abra o app e complete o peso e o romaneio antes de fechar o dia.`;

      await this.enviarPush(
        motoristaId,
        viagens[0]?.motorista?.expoPushToken,
        titulo,
        corpo,
        { rota: "aguardando-peso" },
      );

      const linhas = viagens
        .slice(0, 10)
        .map((v) => {
          const cli = v.cliente?.nome ?? "viagem";
          const loc = v.localDescarga?.nome ? ` (${v.localDescarga.nome})` : "";
          return `• ${cli}${loc}`;
        })
        .join("\n");
      const resto = n > 10 ? `\n…e mais ${n - 10}.` : "";
      if (viagens[0]?.motorista?.aceitaWhatsapp !== false) {
        await this.enviarWhatsapp(
          viagens[0]?.motorista?.telefone,
          `⚖️ *${titulo}*\n\nFalta o peso/romaneio de:\n${linhas}${resto}\n\nAbra o app e complete antes de fechar o dia.`,
        );
      }
    }
  }

  private async enviarPush(
    motoristaId: string,
    token: string | null | undefined,
    titulo: string,
    corpo: string,
    dados: Record<string, unknown>,
  ): Promise<void> {
    if (!token) return;
    await this.push
      .enviar({
        motoristaId,
        token,
        titulo,
        corpo,
        tipo: "aguardando-peso",
        dados,
        criadoPorId: null,
      })
      .catch((err) => {
        this.log.warn(`push aguardando-peso falhou: ${(err as Error).message}`);
      });
  }

  private async enviarWhatsapp(
    telefone: string | null | undefined,
    texto: string,
  ): Promise<void> {
    if (!telefone || !this.evolution.configurado) return;
    try {
      // Evolution exige DDI 55; o telefone do motorista vem só com DDD.
      const numero = SessaoService.normalizar(telefone);
      await this.evolution.enviarTexto(numero, texto);
    } catch (err) {
      this.log.warn(`whatsapp aguardando-peso falhou: ${(err as Error).message}`);
    }
  }
}
