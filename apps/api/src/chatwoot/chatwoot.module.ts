import { Module } from "@nestjs/common";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { ChatwootAgenteService } from "./chatwoot-agente.service";
import { ChatwootClientService } from "./chatwoot-client.service";
import { ChatwootWebhookController } from "./chatwoot-webhook.controller";

/**
 * O atendimento no Chatwoot. Depende do WhatsappModule pelo que já existe lá —
 * `SessaoService` (quem é este telefone) e `AgenteService` (o agente com as
 * ferramentas do sistema). Nada disso é reescrito aqui.
 */
@Module({
  imports: [WhatsappModule],
  controllers: [ChatwootWebhookController],
  providers: [ChatwootAgenteService, ChatwootClientService],
  exports: [ChatwootClientService],
})
export class ChatwootModule {}
