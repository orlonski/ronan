import { Injectable, Logger } from "@nestjs/common";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { NotificacoesService } from "../notificacoes/notificacoes.service";
import { PrismaService } from "../prisma/prisma.service";

const RETRY_DELAYS_MS = [500, 1500, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function isErroTransitorio(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|429|5\d{2})\b/.test(msg);
}

export type EnviarArgs = {
  motoristaId: string;
  token: string;
  titulo: string;
  corpo: string;
  dados?: Record<string, unknown>;
  tipo?: string; // default "mensagem-admin"
};

export type EnviarResultado = { enviado: boolean; motivo?: string };

@Injectable()
export class PushService {
  private readonly log = new Logger("PushService");
  private readonly expo: Expo;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacoes: NotificacoesService,
  ) {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
      useFcmV1: true,
    });
  }

  /**
   * Envia uma push notification via Expo Push Service. Persiste a notificação
   * ANTES de enviar — sobrevive a qualquer falha de rede e fica disponível na
   * central do app. O `notificacaoId` é embutido no payload pra fechar o loop
   * "tap → marcar lida" no app.
   *
   * Retry com backoff em erros transitórios. DeviceNotRegistered no ticket OU
   * no receipt limpa o token do motorista no banco.
   */
  async enviar(args: EnviarArgs): Promise<EnviarResultado> {
    const tipo = args.tipo ?? "mensagem-admin";

    // 1) Persiste registro primeiro. Mesmo se Expo cair, fica no banco.
    const { id: notificacaoId } = await this.notificacoes.registrar({
      motoristaId: args.motoristaId,
      tipo,
      titulo: args.titulo,
      corpo: args.corpo,
      dados: args.dados,
    });

    if (!Expo.isExpoPushToken(args.token)) {
      await this.notificacoes.atualizarEntrega(notificacaoId, {
        entregaStatus: "ERRO",
        entregaErro: "TokenInvalido",
      });
      return { enviado: false, motivo: "Token inválido" };
    }

    // 2) Embute notificacaoId no payload + preserva `kind` pro tap dispatcher
    //    no app saber o tipo (mensagem-admin abre /notificacoes).
    const dadosFinal: Record<string, unknown> = {
      ...(args.dados ?? {}),
      notificacaoId,
      kind: (args.dados?.kind as string | undefined) ?? tipo,
    };

    const message: ExpoPushMessage = {
      to: args.token,
      title: args.titulo,
      body: args.corpo,
      data: dadosFinal,
      // "ding" = asset embutido no app (apps/motorista-app/assets/sounds/ding.wav)
      sound: "ding",
      priority: "high",
      channelId: "default",
    };

    let ticket: ExpoPushTicket | undefined;
    let ultimoErro: unknown;
    for (let tentativa = 0; tentativa <= RETRY_DELAYS_MS.length; tentativa++) {
      try {
        const [resultado] = await this.expo.sendPushNotificationsAsync([message]);
        ticket = resultado;
        break;
      } catch (e) {
        ultimoErro = e;
        if (!isErroTransitorio(e)) break;
        if (tentativa === RETRY_DELAYS_MS.length) break;
        await delay(RETRY_DELAYS_MS[tentativa]);
      }
    }

    if (!ticket) {
      const msg = ultimoErro instanceof Error ? ultimoErro.message : "Falha ao enviar";
      this.log.error(`Push motoristaId=${args.motoristaId}: ${msg}`);
      await this.notificacoes.atualizarEntrega(notificacaoId, {
        entregaStatus: "ERRO",
        entregaErro: `transitorio_max_retry: ${msg.slice(0, 200)}`,
      });
      return { enviado: false, motivo: "Não foi possível enviar agora. Tente de novo." };
    }

    if (ticket.status === "error") {
      const detalhe = ticket.details?.error;
      await this.notificacoes.atualizarEntrega(notificacaoId, {
        entregaStatus: "ERRO",
        entregaErro: detalhe ?? ticket.message ?? "ticket_erro",
      });
      if (detalhe === "DeviceNotRegistered") {
        await this.prisma.motorista.update({
          where: { id: args.motoristaId },
          data: { expoPushToken: null, pushTokenAtualizadoEm: null },
        });
        return {
          enviado: false,
          motivo: "Motorista precisa abrir o app de novo (token expirado).",
        };
      }
      this.log.warn(`Push ticket erro motoristaId=${args.motoristaId}: ${ticket.message}`);
      return { enviado: false, motivo: ticket.message ?? "Erro do Expo" };
    }

    // Ticket "ok" só significa que o Expo aceitou. A entrega real (Expo → FCM →
    // device) é assíncrona — só confirmamos consultando o receipt.
    const ticketId = ticket.id;
    this.log.log(`Push aceita pelo Expo, ticket=${ticketId} motoristaId=${args.motoristaId}`);
    await this.notificacoes.atualizarEntrega(notificacaoId, { expoTicketId: ticketId });

    await delay(3000);
    try {
      const receipts = await this.expo.getPushNotificationReceiptsAsync([ticketId]);
      const receipt = receipts[ticketId];
      if (!receipt) {
        // Receipt ainda não disponível — considera enviado e segue
        // (Expo às vezes leva > 5s; não bloqueia o admin esperando).
        return { enviado: true };
      }
      if (receipt.status === "ok") {
        await this.notificacoes.atualizarEntrega(notificacaoId, { entregaStatus: "ENTREGUE" });
        return { enviado: true };
      }
      // receipt.status === "error"
      const detalhe = receipt.details?.error;
      this.log.warn(
        `Push receipt ERRO motoristaId=${args.motoristaId} ticket=${ticketId} error=${detalhe} message=${receipt.message}`,
      );
      await this.notificacoes.atualizarEntrega(notificacaoId, {
        entregaStatus: "ERRO",
        entregaErro: detalhe ?? receipt.message ?? "receipt_erro",
      });
      if (detalhe === "DeviceNotRegistered") {
        await this.prisma.motorista.update({
          where: { id: args.motoristaId },
          data: { expoPushToken: null, pushTokenAtualizadoEm: null },
        });
        return {
          enviado: false,
          motivo: "Token expirado — motorista precisa abrir o app de novo.",
        };
      }
      return {
        enviado: false,
        motivo: `${detalhe ?? "Erro Expo"}: ${receipt.message ?? "sem detalhe"}`,
      };
    } catch (e) {
      // Falha ao consultar receipt — não bloqueia (Expo já aceitou, provavelmente entregou)
      this.log.warn(`Push receipt consulta falhou motoristaId=${args.motoristaId}: ${e}`);
      return { enviado: true };
    }
  }
}
