import { Module } from "@nestjs/common";
import { UploadsModule } from "../../uploads/uploads.module";
import { ViagensAdminController } from "./viagens.controller";
import { ViagensAdminService } from "./viagens.service";

@Module({
  imports: [UploadsModule],
  controllers: [ViagensAdminController],
  providers: [ViagensAdminService],
})
export class ViagensAdminModule {}
