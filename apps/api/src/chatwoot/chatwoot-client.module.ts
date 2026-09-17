import { Module } from "@nestjs/common";
import { ChatwootClientService } from "./chatwoot-client.service";

/**
 * Só o cliente HTTP do Chatwoot, sem o agente e sem o webhook.
 *
 * Existe pra quebrar um ciclo: o `ChatwootModule` puxa o SDR, que puxa a
 * prospecção — e a prospecção precisa falar com o Chatwoot pra mandar a ficha
 * do lead pro atendimento. Importando este módulo (que não depende de nada
 * além do ConfigService) a seta anda numa direção só.
 */
@Module({
  providers: [ChatwootClientService],
  exports: [ChatwootClientService],
})
export class ChatwootClientModule {}
