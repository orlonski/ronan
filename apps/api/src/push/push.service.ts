import { Injectable, Logger } from "@nestjs/common";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
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
};

export type EnviarResultado = { enviado: boolean; motivo?: string };

@Injectable()
export class PushService {
  private readonly log = new Logger("PushService");
  private readonly expo: Expo;

  constructor(private readonly prisma: PrismaService) {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
      useFcmV1: true,
    });
  }

  /**
   * Envia uma push notification via Expo Push Service. Retry com backoff
   * em erros transitórios de rede. Se o Expo retornar `DeviceNotRegistered`,
   * limpa o token do motorista no banco — aparelho desinstalou ou trocou
   * de identidade, não adianta seguir tentando.
   */
  async enviar({ motoristaId, token, titulo, corpo, dados }: EnviarArgs): Promise<EnviarResultado> {
    if (!Expo.isExpoPushToken(token)) {
      return { enviado: false, motivo: "Token inválido" };
    }

    const message: ExpoPushMessage = {
      to: token,
      title: titulo,
      body: corpo,
      data: dados ?? {},
      sound: "default",
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
      this.log.error(`Push motoristaId=${motoristaId}: ${msg}`);
      return { enviado: false, motivo: "Não foi possível enviar agora. Tente de novo." };
    }

    if (ticket.status === "error") {
      const detalhe = ticket.details?.error;
      if (detalhe === "DeviceNotRegistered") {
        await this.prisma.motorista.update({
          where: { id: motoristaId },
          data: { expoPushToken: null, pushTokenAtualizadoEm: null },
        });
        return {
          enviado: false,
          motivo: "Motorista precisa abrir o app de novo (token expirado).",
        };
      }
      this.log.warn(`Push ticket erro motoristaId=${motoristaId}: ${ticket.message}`);
      return { enviado: false, motivo: ticket.message ?? "Erro do Expo" };
    }

    // Ticket "ok" só significa que o Expo aceitou. A entrega real (Expo → FCM →
    // device) é assíncrona — só confirmamos consultando o receipt. Sem isso,
    // erros como MismatchSenderId/InvalidCredentials passam silenciosos.
    const ticketId = ticket.id;
    this.log.log(`Push aceita pelo Expo, ticket=${ticketId} motoristaId=${motoristaId}`);

    await delay(3000);
    try {
      const receipts = await this.expo.getPushNotificationReceiptsAsync([ticketId]);
      const receipt = receipts[ticketId];
      if (!receipt) {
        // Receipt ainda não disponível — considera enviado e segue.
        // (Expo às vezes leva > 5s; não bloqueia o admin esperando)
        return { enviado: true };
      }
      if (receipt.status === "ok") {
        return { enviado: true };
      }
      // receipt.status === "error" — esse é o caso que estávamos perdendo
      const detalhe = receipt.details?.error;
      this.log.warn(
        `Push receipt ERRO motoristaId=${motoristaId} ticket=${ticketId} error=${detalhe} message=${receipt.message}`,
      );
      if (detalhe === "DeviceNotRegistered") {
        await this.prisma.motorista.update({
          where: { id: motoristaId },
          data: { expoPushToken: null, pushTokenAtualizadoEm: null },
        });
        return { enviado: false, motivo: "Token expirado — motorista precisa abrir o app de novo." };
      }
      return {
        enviado: false,
        motivo: `${detalhe ?? "Erro Expo"}: ${receipt.message ?? "sem detalhe"}`,
      };
    } catch (e) {
      // Falha ao consultar receipt — não bloqueia (Expo já aceitou, provavelmente entregou)
      this.log.warn(`Push receipt consulta falhou motoristaId=${motoristaId}: ${e}`);
      return { enviado: true };
    }
  }
}
