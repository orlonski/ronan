import { Module } from "@nestjs/common";
import { RoteamentoModule } from "../roteamento/roteamento.module";
import { UploadsModule } from "../uploads/uploads.module";
import { MotoristaController } from "./motorista.controller";
import { MotoristaService } from "./motorista.service";
import { ViagensMotoristaController } from "./viagens.controller";
import { ViagensMotoristaService } from "./viagens.service";
import { PedagiosMotoristaController } from "./pedagios.controller";
import { PedagiosMotoristaService } from "./pedagios.service";
import { LocaisMotoristaController } from "./locais.controller";
import { LocaisMotoristaService } from "./locais.service";
import { RotasMotoristaController } from "./rotas.controller";

@Module({
  imports: [UploadsModule, RoteamentoModule],
  controllers: [
    MotoristaController,
    ViagensMotoristaController,
    PedagiosMotoristaController,
    LocaisMotoristaController,
    RotasMotoristaController,
  ],
  providers: [
    MotoristaService,
    ViagensMotoristaService,
    PedagiosMotoristaService,
    LocaisMotoristaService,
  ],
})
export class MotoristaModule {}
