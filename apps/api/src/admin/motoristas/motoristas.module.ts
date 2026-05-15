import { Module } from "@nestjs/common";
import { UploadsModule } from "../../uploads/uploads.module";
import { PushModule } from "../../push/push.module";
import { MotoristasController } from "./motoristas.controller";
import { MotoristasService } from "./motoristas.service";
import { MotoristasDocumentosController } from "./documentos.controller";
import { MotoristasDocumentosService } from "./documentos.service";

@Module({
  imports: [UploadsModule, PushModule],
  controllers: [MotoristasController, MotoristasDocumentosController],
  providers: [MotoristasService, MotoristasDocumentosService],
})
export class MotoristasModule {}
