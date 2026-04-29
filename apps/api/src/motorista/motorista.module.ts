import { Module } from "@nestjs/common";
import { MotoristaController } from "./motorista.controller";
import { MotoristaService } from "./motorista.service";
import { ViagensMotoristaController } from "./viagens.controller";
import { ViagensMotoristaService } from "./viagens.service";
import { PedagiosMotoristaController } from "./pedagios.controller";
import { PedagiosMotoristaService } from "./pedagios.service";

@Module({
  controllers: [MotoristaController, ViagensMotoristaController, PedagiosMotoristaController],
  providers: [MotoristaService, ViagensMotoristaService, PedagiosMotoristaService],
})
export class MotoristaModule {}
