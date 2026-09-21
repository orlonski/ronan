import { Module } from "@nestjs/common";
import { PushModule } from "../push/push.module";
import { UploadsModule } from "../uploads/uploads.module";
import {
  AdmissaoAdminController,
  AdmissaoMotoristaController,
  ColetaPublicaController,
} from "./admissao.controller";
import { AdmissaoService } from "./admissao.service";

@Module({
  imports: [UploadsModule, PushModule],
  controllers: [AdmissaoAdminController, AdmissaoMotoristaController, ColetaPublicaController],
  providers: [AdmissaoService],
  // Exportado pro upload do painel usar a MESMA regra de gravação: era ele que
  // divergia, deixando assinatura órfã ao trocar o arquivo.
  exports: [AdmissaoService],
})
export class AdmissaoModule {}
