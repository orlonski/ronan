import { Module } from "@nestjs/common";
import { EvolutionModule } from "../../whatsapp/evolution.module";
import { FrotaManutencaoModule } from "../frota-manutencao/frota-manutencao.module";
import { ResumoController } from "./resumo.controller";
import { ResumoService } from "./resumo.service";

@Module({
  imports: [EvolutionModule, FrotaManutencaoModule],
  controllers: [ResumoController],
  providers: [ResumoService],
})
export class ResumoModule {}
