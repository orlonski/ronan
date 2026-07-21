import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { LocaisImagemService } from "./locais-imagem.service";

@Module({
  imports: [UploadsModule],
  providers: [LocaisImagemService],
  exports: [LocaisImagemService],
})
export class LocaisImagemModule {}
