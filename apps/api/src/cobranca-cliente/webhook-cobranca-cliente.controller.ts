import { Body, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { CobrancaClienteService } from "./cobranca-cliente.service";
import { WebhookCobrancaClienteGuard } from "./webhook-cobranca-cliente.guard";

/**
 * Webhook do Asaas de cada transportadora (fatura do cliente dela).
 *
 * Separado do `pagamentos/webhook/asaas` da mensalidade de propósito: lá o
 * segredo é da Movatruck e o dinheiro é nosso; aqui o segredo é de cada conta
 * e o dinheiro é dela. Uma rota só obrigaria um token a abrir as duas.
 *
 * Responde 200 depois de autenticado, mesmo quando o evento não se aplica: o
 * Asaas reenvia qualquer resposta fora de 2xx e, com 15 falhas seguidas,
 * INTERROMPE a fila da transportadora inteira. O evento fica guardado com o
 * erro, e o botão "Atualizar situação" do título refaz pelo status do Asaas.
 */
@ApiExcludeController()
@Controller("cobranca-cliente/webhook")
export class WebhookCobrancaClienteController {
  constructor(private readonly service: CobrancaClienteService) {}

  @Public()
  @UseGuards(WebhookCobrancaClienteGuard)
  @HttpCode(200)
  @Post("asaas/:contaId")
  async asaas(@Param("contaId") contaId: string, @Body() body: Record<string, unknown>) {
    return this.service.receberEvento(contaId, body ?? {});
  }
}
