import { Module } from "@nestjs/common";
import { UploadsModule } from "../../uploads/uploads.module";
import { MotoristasController } from "./motoristas.controller";
import { MotoristasService } from "./motoristas.service";
import { MotoristasDocumentosController } from "./documentos.controller";
import { MotoristasDocumentosService } from "./documentos.service";

@Module({
  imports: [UploadsModule],
  controllers: [MotoristasController, MotoristasDocumentosController],
  providers: [MotoristasService, MotoristasDocumentosService],
})
export class MotoristasModule {}
