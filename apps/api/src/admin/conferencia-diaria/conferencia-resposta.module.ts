import { Module } from "@nestjs/common";
import { EvolutionModule } from "../../whatsapp/evolution.module";
import { AdminInboxModule } from "../inbox/inbox.module";
import { ConferenciaAlcanceService } from "./conferencia-alcance.service";
import { ConferenciaRespostaService } from "./conferencia-resposta.service";
import { SugestoesGestorService } from "./sugestoes-gestor.service";

/**
 * A metade da conferência diária que o WEBHOOK da Meta e o agente do Chatwoot
 * precisam (resposta, alcance, fila do gestor). Separado de
 * `ConferenciaDiariaModule` de propósito: aquele importa o módulo de motoristas
 * (pra aprovar a inativação), e o WhatsappModule não pode depender disso sem
 * fechar um ciclo.
 */
@Module({
  imports: [EvolutionModule, AdminInboxModule],
  providers: [SugestoesGestorService, ConferenciaAlcanceService, ConferenciaRespostaService],
  exports: [SugestoesGestorService, ConferenciaAlcanceService, ConferenciaRespostaService],
})
export class ConferenciaRespostaModule {}
