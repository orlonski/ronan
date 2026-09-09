import { Body, Controller, HttpCode, Logger, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { ChatwootAgenteService } from "./chatwoot-agente.service";
import { ChatwootTokenGuard } from "./chatwoot-token.guard";

/**
 * Webhook do Chatwoot: cada mensagem que chega numa conversa cai aqui.
 *
 * Responde 200 SEMPRE, e antes de processar. O Chatwoot reenvia o que falha, e
 * reenvio aqui não é retentativa inofensiva — é o motorista recebendo a mesma
 * resposta do agente de novo.
 *
 * Fora do Swagger: documentar publicamente o endereço que dispara o agente não
 * ajuda ninguém além de quem procura.
 */
@ApiExcludeController()
@Controller("chatwoot")
export class ChatwootWebhookController {
  private readonly log = new Logger("ChatwootWebhook");

  constructor(private readonly agente: ChatwootAgenteService) {}

  // @Public() tira do JwtAuthGuard global; quem chama é máquina, e a
  // autenticação é o segredo na URL (ChatwootTokenGuard).
  @Public()
  @UseGuards(ChatwootTokenGuard)
  @HttpCode(200)
  @Post("webhook")
  receber(@Body() body: Record<string, unknown>): string {
    // Sem `await`: o Chatwoot não precisa esperar o modelo pensar, e um
    // provider lento não pode virar timeout do lado dele.
    void this.agente.processar(body);
    return "ok";
  }
}
