import { Module } from "@nestjs/common";
import { UploadsModule } from "../../uploads/uploads.module";
import { EtapasNucleoModule } from "../../etapas/etapas-nucleo.module";
import { EtapasModelosController, EtapasViagemAdminController } from "./etapas-admin.controller";
import { EtapasAdminService } from "./etapas-admin.service";

/** Etapas da viagem no painel (módulo `etapas`). */
@Module({
  imports: [UploadsModule, EtapasNucleoModule],
  controllers: [EtapasModelosController, EtapasViagemAdminController],
  providers: [EtapasAdminService],
})
export class EtapasAdminModule {}
