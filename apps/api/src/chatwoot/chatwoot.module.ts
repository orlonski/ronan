import { Module } from "@nestjs/common";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { SdrModule } from "../sdr/sdr.module";
import { ChatwootAgenteService } from "./chatwoot-agente.service";
import { ChatwootClientService } from "./chatwoot-client.service";
import { ChatwootWebhookController } from "./chatwoot-webhook.controller";

/**
 * O atendimento no Chatwoot. Depende do WhatsappModule pelo que já existe lá —
 * `SessaoService` (quem é este telefone) e `AgenteService` (o agente com as
 * ferramentas do sistema). Nada disso é reescrito aqui.
 *
 * O `SdrModule` entra pela outra ponta do mesmo webhook: motorista conhecido
 * fala com o agente do sistema, prospect conhecido fala com o SDR. São dois
 * agentes com ferramentas separadas, e a separação é o que impede um número
 * qualquer de alcançar dado de transportadora.
 */
@Module({
  imports: [WhatsappModule, SdrModule],
  controllers: [ChatwootWebhookController],
  providers: [ChatwootAgenteService, ChatwootClientService],
  exports: [ChatwootClientService],
})
export class ChatwootModule {}
