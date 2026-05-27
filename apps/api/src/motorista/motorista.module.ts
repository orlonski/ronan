import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../auditoria/auditoria.module";
import { GeocodingModule } from "../geocoding/geocoding.module";
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
import { ValidacaoLocalService } from "./validacao-local.service";

@Module({
  imports: [
    UploadsModule,
    RoteamentoModule,
    TrackingConfigModule,
    GeocodingModule,
    AuditoriaModule,
  ],
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
    ValidacaoLocalService,
  ],
  exports: [
    MotoristaService,
    ViagensMotoristaService,
    AbastecimentosMotoristaService,
    ValidacaoLocalService,
  ],
})
export class MotoristaModule {}
