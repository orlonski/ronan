import { Module } from "@nestjs/common";
import { PushModule } from "../../push/push.module";
import { RoteamentoModule } from "../../roteamento/roteamento.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { PedagiosRodoviaModule } from "../pedagios-rodovia/pedagios-rodovia.module";
import { BuscaLocaisConfigModule } from "../busca-locais-config/busca-locais-config.module";
import { GeocodingModule } from "../../geocoding/geocoding.module";
import { KmAtipicoModule } from "../../km-atipico/km-atipico.module";
import { ViagemMensagensModule } from "../../viagem-mensagens/viagem-mensagens.module";
import { ViagensAdminController } from "./viagens.controller";
import { ViagensAdminService } from "./viagens.service";

@Module({
  imports: [
    UploadsModule,
    RoteamentoModule,
    PushModule,
    PedagiosRodoviaModule,
    BuscaLocaisConfigModule,
    GeocodingModule,
    KmAtipicoModule,
    ViagemMensagensModule,
  ],
  controllers: [ViagensAdminController],
  providers: [ViagensAdminService],
})
export class ViagensAdminModule {}
