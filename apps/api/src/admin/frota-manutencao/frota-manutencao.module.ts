import { Module } from "@nestjs/common";
import {
  DocumentosVeiculoController,
  ManutencaoController,
  MultasController,
  PneusController,
  ProblemasVeiculoMotoristaController,
} from "./frota-manutencao.controller";
import { UploadsModule } from "../../uploads/uploads.module";
import { FrotaManutencaoService } from "./frota-manutencao.service";

@Module({
  imports: [UploadsModule],
  controllers: [
    ManutencaoController,
    PneusController,
    MultasController,
    DocumentosVeiculoController,
    ProblemasVeiculoMotoristaController,
  ],
  providers: [FrotaManutencaoService],
  exports: [FrotaManutencaoService],
})
export class FrotaManutencaoModule {}
