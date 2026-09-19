import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { AdmissaoAdminController, ColetaPublicaController } from "./admissao.controller";
import { AdmissaoService } from "./admissao.service";

@Module({
  imports: [UploadsModule],
  controllers: [AdmissaoAdminController, ColetaPublicaController],
  providers: [AdmissaoService],
})
export class AdmissaoModule {}
