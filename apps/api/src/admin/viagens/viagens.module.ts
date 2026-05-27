import { Module } from "@nestjs/common";
import { RoteamentoModule } from "../../roteamento/roteamento.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { ViagensAdminController } from "./viagens.controller";
import { ViagensAdminService } from "./viagens.service";

@Module({
  imports: [UploadsModule, RoteamentoModule],
  controllers: [ViagensAdminController],
  providers: [ViagensAdminService],
})
export class ViagensAdminModule {}
