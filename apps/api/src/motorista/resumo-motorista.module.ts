import { Module } from "@nestjs/common";
import { EvolutionModule } from "../whatsapp/evolution.module";
import { ResumoMotoristaService } from "./resumo-motorista.service";

/**
 * Provê o ResumoMotoristaService (cron 20h + disparo manual). Importado pelo
 * módulo admin de motoristas, que roda o cron e expõe o botão "enviar agora".
 */
@Module({
  imports: [EvolutionModule],
  providers: [ResumoMotoristaService],
  exports: [ResumoMotoristaService],
})
export class ResumoMotoristaModule {}
