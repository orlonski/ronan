import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { PermissoesModule } from "../permissoes/permissoes.module";
import { ContasController } from "./contas.controller";
import { ContasService } from "./contas.service";

/**
 * `CamposLayoutModule` não entra nos imports porque é `@Global`.
 */
@Module({
  imports: [PermissoesModule, AuthModule],
  controllers: [ContasController],
  providers: [ContasService],
  exports: [ContasService],
})
export class ContasModule {}
