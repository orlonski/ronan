import { Module } from "@nestjs/common";
import { PushModule } from "../../push/push.module";
import { RoteamentoModule } from "../../roteamento/roteamento.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { ViagensAdminController } from "./viagens.controller";
import { ViagensAdminService } from "./viagens.service";

@Module({
  imports: [UploadsModule, RoteamentoModule, PushModule],
  controllers: [ViagensAdminController],
  providers: [ViagensAdminService],
})
export class ViagensAdminModule {}
