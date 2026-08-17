import { Module } from "@nestjs/common";
import { AvisoGrupoService } from "./aviso-grupo.service";
import { EvolutionClientService } from "./evolution-client.service";
import { EnvioWhatsappService } from "./envio/envio-whatsapp.service";
import { EvolutionProvedor } from "./envio/evolution.provedor";

/**
 * Módulo fino do WhatsApp de saída. Separado do WhatsappModule (pesado — agente
 * IA, transcrição, etc) pra outros módulos (ex: auth, no auto-cadastro) poderem
 * mandar mensagem WhatsApp sem importar tudo.
 *
 * Quem manda mensagem usa o `EnvioWhatsappService`, que escolhe o provedor. O
 * `EvolutionClientService` continua exportado porque o que é só do Evolution —
 * grupos, QR code, status da instância, download de mídia — não tem equivalente
 * na Cloud API e é consumido direto pelo painel e pelo agente.
 */
@Module({
  providers: [EvolutionClientService, EvolutionProvedor, EnvioWhatsappService, AvisoGrupoService],
  exports: [EvolutionClientService, EnvioWhatsappService, AvisoGrupoService],
})
export class EvolutionModule {}
