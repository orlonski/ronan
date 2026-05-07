import { Module } from "@nestjs/common";
import { RoteamentoModule } from "../roteamento/roteamento.module";
import { TrackingConfigModule } from "../admin/tracking-config/tracking-config.module";
import { UploadsModule } from "../uploads/uploads.module";
import { MotoristaController } from "./motorista.controller";
import { MotoristaService } from "./motorista.service";
import { ViagensMotoristaController } from "./viagens.controller";
import { ViagensMotoristaService } from "./viagens.service";
import { PedagiosMotoristaController } from "./pedagios.controller";
import { PedagiosMotoristaService } from "./pedagios.service";
import { AbastecimentosMotoristaController } from "./abastecimentos.controller";
import { AbastecimentosMotoristaService } from "./abastecimentos.service";
import { LocaisMotoristaController } from "./locais.controller";
import { LocaisMotoristaService } from "./locais.service";
import { RotasMotoristaController } from "./rotas.controller";
import { TrackingConfigMotoristaController } from "./tracking-config.controller";

@Module({
  imports: [UploadsModule, RoteamentoModule, TrackingConfigModule],
  controllers: [
    MotoristaController,
    ViagensMotoristaController,
    PedagiosMotoristaController,
    AbastecimentosMotoristaController,
    LocaisMotoristaController,
    RotasMotoristaController,
    TrackingConfigMotoristaController,
  ],
  providers: [
    MotoristaService,
    ViagensMotoristaService,
    PedagiosMotoristaService,
    AbastecimentosMotoristaService,
    LocaisMotoristaService,
  ],
})
export class MotoristaModule {}
