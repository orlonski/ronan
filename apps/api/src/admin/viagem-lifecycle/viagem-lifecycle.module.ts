import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import {
  TiposEventoViagemController,
  ViagensAndamentoAdminController,
} from "./viagem-lifecycle.controller";
import { ViagemLifecycleAdminService } from "./viagem-lifecycle.service";

@Module({
  imports: [AuditoriaModule],
  controllers: [TiposEventoViagemController, ViagensAndamentoAdminController],
  providers: [ViagemLifecycleAdminService],
})
export class ViagemLifecycleAdminModule {}
