import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { PermissoesModule } from "../permissoes/permissoes.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { ContasController, MinhaEmpresaController } from "./contas.controller";
import { LogoPublicaController } from "./logo-publica.controller";
import { ContasService } from "./contas.service";
import { TrialService } from "./trial.service";
import { SdrModule } from "../../sdr/sdr.module";

/**
 * `CamposLayoutModule` não entra nos imports porque é `@Global`.
 */
@Module({
  imports: [PermissoesModule, AuthModule, UploadsModule, SdrModule],
  controllers: [ContasController, MinhaEmpresaController, LogoPublicaController],
  providers: [ContasService, TrialService],
  exports: [ContasService],
})
export class ContasModule {}
