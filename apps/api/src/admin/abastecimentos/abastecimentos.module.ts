import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import { PushModule } from "../../push/push.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { AbastecimentosAdminController } from "./abastecimentos.controller";
import { AbastecimentosAdminService } from "./abastecimentos.service";
import { AbastecimentoSinaisService } from "./abastecimento-sinais.service";

@Module({
  imports: [UploadsModule, AuditoriaModule, PushModule],
  controllers: [AbastecimentosAdminController],
  providers: [AbastecimentosAdminService, AbastecimentoSinaisService],
})
export class AbastecimentosAdminModule {}
