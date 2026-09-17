import { Module } from "@nestjs/common";
import { PrecosModule } from "../admin/precos/precos.module";
import { ProspeccaoModule } from "../prospeccao/prospeccao.module";
import { SdrService } from "./sdr.service";
import { FollowupService } from "./followup.service";

/**
 * O SDR reusa a abstração de provider do agente (Anthropic/Gemini) e nada
 * mais: prompt, ferramentas e histórico são próprios. Os providers são
 * instanciados dentro do serviço, como o agente do motorista faz.
 */
@Module({
  imports: [PrecosModule, ProspeccaoModule],
  providers: [SdrService, FollowupService],
  exports: [SdrService, FollowupService],
})
export class SdrModule {}
