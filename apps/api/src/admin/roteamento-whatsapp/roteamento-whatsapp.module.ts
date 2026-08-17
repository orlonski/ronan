import { Module } from "@nestjs/common";
import { EvolutionModule } from "../../whatsapp/evolution.module";
import { AdminRoteamentoWhatsappController } from "./roteamento-whatsapp.controller";
import { AdminRoteamentoWhatsappService } from "./roteamento-whatsapp.service";

@Module({
  // Pelo roteador — salvar precisa invalidar o cache dele na hora.
  imports: [EvolutionModule],
  controllers: [AdminRoteamentoWhatsappController],
  providers: [AdminRoteamentoWhatsappService],
})
export class AdminRoteamentoWhatsappModule {}
