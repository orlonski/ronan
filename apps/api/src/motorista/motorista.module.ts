import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../auditoria/auditoria.module";
import { EventosModule } from "../eventos/eventos.module";
import { GeocodingModule } from "../geocoding/geocoding.module";
import { RoteamentoModule } from "../roteamento/roteamento.module";
import { PushModule } from "../push/push.module";
import { TrackingConfigModule } from "../admin/tracking-config/tracking-config.module";
import { BuscaLocaisConfigModule } from "../admin/busca-locais-config/busca-locais-config.module";
import { ForcaAtualizacaoModule } from "../admin/forca-atualizacao/forca-atualizacao.module";
import { PedagiosRodoviaModule } from "../admin/pedagios-rodovia/pedagios-rodovia.module";
import { AdminInboxModule } from "../admin/inbox/inbox.module";
import { EvolutionModule } from "../whatsapp/evolution.module";
import { UploadsModule } from "../uploads/uploads.module";
import { MotoristaController } from "./motorista.controller";
import { MotoristaService } from "./motorista.service";
import { ViagensMotoristaController } from "./viagens.controller";
import { ViagemLifecycleController } from "./viagem-lifecycle.controller";
import { ViagensMotoristaService } from "./viagens.service";
import { PedagiosMotoristaController } from "./pedagios.controller";
import { PedagiosMotoristaService } from "./pedagios.service";
import { PedagiosRodoviaMotoristaController } from "./pedagios-rodovia.controller";
import { AbastecimentosMotoristaController } from "./abastecimentos.controller";
import { AbastecimentosMotoristaService } from "./abastecimentos.service";
import { LocaisMotoristaController } from "./locais.controller";
import { LocaisMotoristaService } from "./locais.service";
import { PosicaoMotoristaController } from "./posicao.controller";
import { PosicaoMotoristaService } from "./posicao.service";
import { RotasMotoristaController } from "./rotas.controller";
import { KmReferenciaMotoristaController } from "./km-referencia.controller";
import { TrackingConfigMotoristaController } from "./tracking-config.controller";
import { BuscaLocaisConfigMotoristaController } from "./busca-locais-config.controller";
import { ValidacaoLocalService } from "./validacao-local.service";
import { IaTicketController } from "./ia-ticket.controller";
import { KmReprocessamentoService } from "./km-reprocessamento.service";
import { KmAtipicoModule } from "../km-atipico/km-atipico.module";
import { AvisoPesoService } from "./aviso-peso.service";
import { StoriesMotoristaController } from "./stories.controller";
import { StoriesMotoristaService } from "./stories.service";
import { StoriesCleanupService } from "./stories-cleanup.service";
import { VersaoAppMotoristaController } from "./versao-app.controller";

@Module({
  imports: [
    UploadsModule,
    RoteamentoModule,
    TrackingConfigModule,
    BuscaLocaisConfigModule,
    GeocodingModule,
    AuditoriaModule,
    EventosModule,
    PedagiosRodoviaModule,
    AdminInboxModule,
    PushModule,
    EvolutionModule,
    ForcaAtualizacaoModule,
    KmAtipicoModule,
  ],
  controllers: [
    MotoristaController,
    ViagensMotoristaController,
    ViagemLifecycleController,
    PedagiosMotoristaController,
    PedagiosRodoviaMotoristaController,
    AbastecimentosMotoristaController,
    LocaisMotoristaController,
    RotasMotoristaController,
    KmReferenciaMotoristaController,
    TrackingConfigMotoristaController,
    BuscaLocaisConfigMotoristaController,
    IaTicketController,
    PosicaoMotoristaController,
    StoriesMotoristaController,
    VersaoAppMotoristaController,
  ],
  providers: [
    MotoristaService,
    ViagensMotoristaService,
    PedagiosMotoristaService,
    AbastecimentosMotoristaService,
    LocaisMotoristaService,
    ValidacaoLocalService,
    PosicaoMotoristaService,
    KmReprocessamentoService,
    AvisoPesoService,
    StoriesMotoristaService,
    StoriesCleanupService,
  ],
  exports: [
    MotoristaService,
    ViagensMotoristaService,
    AbastecimentosMotoristaService,
    ValidacaoLocalService,
  ],
})
export class MotoristaModule {}
