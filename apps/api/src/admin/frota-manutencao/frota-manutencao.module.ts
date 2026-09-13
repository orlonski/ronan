import { Module } from "@nestjs/common";
import {
  DocumentosVeiculoController,
  ManutencaoController,
  MultasController,
  PneusController,
} from "./frota-manutencao.controller";
import { FrotaManutencaoService } from "./frota-manutencao.service";

@Module({
  controllers: [
    ManutencaoController,
    PneusController,
    MultasController,
    DocumentosVeiculoController,
  ],
  providers: [FrotaManutencaoService],
  exports: [FrotaManutencaoService],
})
export class FrotaManutencaoModule {}
