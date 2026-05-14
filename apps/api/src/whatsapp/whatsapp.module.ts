import { forwardRef, Module } from "@nestjs/common";
import { MotoristaModule } from "../motorista/motorista.module";
import { DashboardModule } from "../admin/dashboard/dashboard.module";
import { ErrorsModule } from "../errors/errors.module";
import { UploadsModule } from "../uploads/uploads.module";
import { AgenteService } from "./agente/agente.service";
import { ConviteService } from "./convite.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";
import { TranscricaoService } from "./transcricao.service";
import { WhatsappController } from "./whatsapp.controller";
import { WhatsappService } from "./whatsapp.service";

@Module({
  imports: [MotoristaModule, DashboardModule, ErrorsModule, UploadsModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    EvolutionClientService,
    SessaoService,
    ConviteService,
    AgenteService,
    TranscricaoService,
  ],
  exports: [WhatsappService, SessaoService, ConviteService, EvolutionClientService],
})
export class WhatsappModule {}
