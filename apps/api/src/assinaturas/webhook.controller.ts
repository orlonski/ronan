import { Body, Controller, HttpCode, Logger, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { AsaasWebhookGuard } from "./asaas-webhook.guard";
import { EventosGatewayService } from "./eventos-gateway.service";

/** O envelope que o Asaas manda. Tudo opcional: campo novo não pode dar 400. */
type EventoAsaas = {
  id?: string;
  event?: string;
  dateCreated?: string;
};

/**
 * Webhook do gateway de pagamento.
 *
 * Duas regras, e as duas existem por causa de como o Asaas trata erro:
 *
 * 1. **Responde 200 quase sempre.** Qualquer resposta fora da faixa 2xx faz o
 *    evento voltar pra fila, e 15 falhas seguidas INTERROMPEM a fila inteira —
 *    de todos os clientes, com 14 dias pra consertar antes de os eventos serem
 *    apagados. Evento que a gente não entende é 200 com "ignorado", não 400.
 * 2. **Não faz nada pesado.** Guarda o cru, aplica, responde. O gateway
 *    reenvia em timeout, e reenvio é exatamente o que a idempotência existe
 *    pra absorver.
 *
 * Fora do Swagger: documentar publicamente a rota que dá baixa em mensalidade
 * não ajuda ninguém além de quem procura.
 */
@ApiExcludeController()
@Controller("pagamentos")
export class PagamentosWebhookController {
  private readonly log = new Logger("PagamentosWebhook");

  constructor(private readonly eventos: EventosGatewayService) {}

  // `@Public()` = fora do JwtAuthGuard global. Quem chama é máquina do gateway:
  // a autenticação é o segredo compartilhado do AsaasWebhookGuard.
  @Public()
  @UseGuards(AsaasWebhookGuard)
  @HttpCode(200)
  @Post("webhook/asaas")
  async asaas(@Body() body: EventoAsaas & Record<string, unknown>) {
    const eventoId = typeof body?.id === "string" ? body.id : null;
    const tipo = typeof body?.event === "string" ? body.event : null;

    if (!eventoId || !tipo) {
      // 200 de propósito: um corpo que a gente não reconhece nunca vai passar a
      // ser reconhecido por insistência, e devolver erro só serviria pra
      // derrubar a fila de quem paga em dia.
      this.log.warn("Evento sem id ou sem tipo — ignorado.");
      return { status: "ignorado" };
    }

    const r = await this.eventos.receber(eventoId, tipo, body);
    if (r.status === "falhou") {
      // Mesmo aqui a resposta é 200: o evento está guardado no banco, com o
      // erro registrado, e o que falta é conserto nosso — reenviar não muda
      // nada e derrubaria a fila.
      this.log.error(`Evento ${eventoId} guardado mas não aplicado: ${r.detalhe}`);
    }
    return { status: r.status };
  }
}
