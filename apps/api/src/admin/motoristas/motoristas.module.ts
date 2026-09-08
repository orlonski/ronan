import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { PushModule } from "../../push/push.module";
import { EvolutionModule } from "../../whatsapp/evolution.module";
import { ResumoMotoristaModule } from "../../motorista/resumo-motorista.module";
import { MotoristasController } from "./motoristas.controller";
import { MotoristasService } from "./motoristas.service";
import { MotoristasDocumentosController } from "./documentos.controller";
import { MotoristasDocumentosService } from "./documentos.service";
import { EasUpdateService } from "./eas-update.service";
import { AppUpdateNotifierService } from "./app-update-notifier.service";
import { AppDeployController } from "./app-deploy.controller";

@Module({
  imports: [AuthModule, UploadsModule, PushModule, EvolutionModule, ResumoMotoristaModule],
  controllers: [MotoristasController, MotoristasDocumentosController, AppDeployController],
  providers: [
    MotoristasService,
    MotoristasDocumentosService,
    EasUpdateService,
    AppUpdateNotifierService,
  ],
})
export class MotoristasModule {}
