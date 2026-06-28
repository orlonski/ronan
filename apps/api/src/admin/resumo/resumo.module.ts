import { Module } from "@nestjs/common";
import { EvolutionModule } from "../../whatsapp/evolution.module";
import { ResumoController } from "./resumo.controller";
import { ResumoService } from "./resumo.service";

@Module({
  imports: [EvolutionModule],
  controllers: [ResumoController],
  providers: [ResumoService],
})
export class ResumoModule {}
