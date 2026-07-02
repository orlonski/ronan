import { Module } from "@nestjs/common";
import {
  TiposEventoViagemController,
  ViagensAndamentoAdminController,
} from "./viagem-lifecycle.controller";
import { ViagemLifecycleAdminService } from "./viagem-lifecycle.service";

@Module({
  controllers: [TiposEventoViagemController, ViagensAndamentoAdminController],
  providers: [ViagemLifecycleAdminService],
})
export class ViagemLifecycleAdminModule {}
