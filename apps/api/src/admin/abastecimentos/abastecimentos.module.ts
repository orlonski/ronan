import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import { PushModule } from "../../push/push.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { AbastecimentosAdminController } from "./abastecimentos.controller";
import { AbastecimentosAdminService } from "./abastecimentos.service";

@Module({
  imports: [UploadsModule, AuditoriaModule, PushModule],
  controllers: [AbastecimentosAdminController],
  providers: [AbastecimentosAdminService],
})
export class AbastecimentosAdminModule {}
