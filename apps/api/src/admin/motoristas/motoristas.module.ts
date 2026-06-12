import { Module } from "@nestjs/common";
import { UploadsModule } from "../../uploads/uploads.module";
import { PushModule } from "../../push/push.module";
import { MotoristasController } from "./motoristas.controller";
import { MotoristasService } from "./motoristas.service";
import { MotoristasDocumentosController } from "./documentos.controller";
import { MotoristasDocumentosService } from "./documentos.service";
import { EasUpdateService } from "./eas-update.service";
import { AppUpdateNotifierService } from "./app-update-notifier.service";
import { AppDeployController } from "./app-deploy.controller";

@Module({
  imports: [UploadsModule, PushModule],
  controllers: [MotoristasController, MotoristasDocumentosController, AppDeployController],
  providers: [
    MotoristasService,
    MotoristasDocumentosService,
    EasUpdateService,
    AppUpdateNotifierService,
  ],
})
export class MotoristasModule {}
