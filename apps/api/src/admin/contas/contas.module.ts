import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { PermissoesModule } from "../permissoes/permissoes.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { ContasController, MinhaEmpresaController } from "./contas.controller";
import { LogoPublicaController } from "./logo-publica.controller";
import { ContasService } from "./contas.service";

/**
 * `CamposLayoutModule` não entra nos imports porque é `@Global`.
 */
@Module({
  imports: [PermissoesModule, AuthModule, UploadsModule],
  controllers: [ContasController, MinhaEmpresaController, LogoPublicaController],
  providers: [ContasService],
  exports: [ContasService],
})
export class ContasModule {}
