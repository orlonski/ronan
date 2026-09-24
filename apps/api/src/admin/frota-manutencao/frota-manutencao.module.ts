import { Module } from "@nestjs/common";
import {
  DocumentosVeiculoController,
  ManutencaoController,
  MultasController,
  PneusController,
  ProblemasVeiculoMotoristaController,
} from "./frota-manutencao.controller";
import { UploadsModule } from "../../uploads/uploads.module";
import { AdminInboxModule } from "../inbox/inbox.module";
import { PushModule } from "../../push/push.module";
import { FrotaManutencaoService } from "./frota-manutencao.service";

@Module({
  imports: [UploadsModule, AdminInboxModule, PushModule],
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
