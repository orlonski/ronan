import { Module } from "@nestjs/common";
import { UploadsModule } from "../../uploads/uploads.module";
import { AbastecimentosAdminController } from "./abastecimentos.controller";
import { AbastecimentosAdminService } from "./abastecimentos.service";

@Module({
  imports: [UploadsModule],
  controllers: [AbastecimentosAdminController],
  providers: [AbastecimentosAdminService],
})
export class AbastecimentosAdminModule {}
