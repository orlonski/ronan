import { Module } from "@nestjs/common";
import { EvolutionModule } from "../../whatsapp/evolution.module";
import { MotoristasModule } from "../motoristas/motoristas.module";
import { ConferenciaRespostaModule } from "./conferencia-resposta.module";
import { ConferenciaDiariaController } from "./conferencia-diaria.controller";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

@Module({
  imports: [EvolutionModule, ConferenciaRespostaModule, MotoristasModule],
  controllers: [ConferenciaDiariaController],
  providers: [ConferenciaDiariaService],
  exports: [ConferenciaDiariaService],
})
export class ConferenciaDiariaModule {}
