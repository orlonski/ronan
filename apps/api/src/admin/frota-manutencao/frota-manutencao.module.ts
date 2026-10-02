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
import { CustosManutencaoService } from "./custos-manutencao.service";
import { ChecklistService } from "./checklist.service";
import { ChecklistController, ChecklistMotoristaController } from "./checklist.controller";

@Module({
  imports: [UploadsModule, AdminInboxModule, PushModule],
  controllers: [
    ManutencaoController,
    PneusController,
    MultasController,
    DocumentosVeiculoController,
    ProblemasVeiculoMotoristaController,
    ChecklistController,
    ChecklistMotoristaController,
  ],
  providers: [FrotaManutencaoService, CustosManutencaoService, ChecklistService],
  exports: [FrotaManutencaoService, ChecklistService],
})
export class FrotaManutencaoModule {}
