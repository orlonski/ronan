import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../auditoria/auditoria.module";
import { EventosModule } from "../eventos/eventos.module";
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
import { PosicaoMotoristaController } from "./posicao.controller";
import { PosicaoMotoristaService } from "./posicao.service";
import { RotasMotoristaController } from "./rotas.controller";
import { TrackingConfigMotoristaController } from "./tracking-config.controller";
import { ValidacaoLocalService } from "./validacao-local.service";
import { IaTicketController } from "./ia-ticket.controller";

@Module({
  imports: [
    UploadsModule,
    RoteamentoModule,
    TrackingConfigModule,
    GeocodingModule,
    AuditoriaModule,
    EventosModule,
  ],
  controllers: [
    MotoristaController,
    ViagensMotoristaController,
    PedagiosMotoristaController,
    AbastecimentosMotoristaController,
    LocaisMotoristaController,
    RotasMotoristaController,
    TrackingConfigMotoristaController,
    IaTicketController,
    PosicaoMotoristaController,
  ],
  providers: [
    MotoristaService,
    ViagensMotoristaService,
    PedagiosMotoristaService,
    AbastecimentosMotoristaService,
    LocaisMotoristaService,
    ValidacaoLocalService,
    PosicaoMotoristaService,
  ],
  exports: [
    MotoristaService,
    ViagensMotoristaService,
    AbastecimentosMotoristaService,
    ValidacaoLocalService,
  ],
})
export class MotoristaModule {}
