import { Module } from "@nestjs/common";
import { AvisoGrupoService } from "./aviso-grupo.service";
import { EvolutionClientService } from "./evolution-client.service";

/**
 * Módulo fino só pra expor o EvolutionClientService. Separado do WhatsappModule
 * (pesado — agente IA, transcrição, etc) pra outros módulos (ex: auth, no
 * auto-cadastro) poderem mandar mensagem WhatsApp sem importar tudo.
 */
@Module({
  providers: [EvolutionClientService, AvisoGrupoService],
  exports: [EvolutionClientService, AvisoGrupoService],
})
export class EvolutionModule {}
