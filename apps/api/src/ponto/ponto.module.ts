import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LancamentosResgatadosModule } from "../lancamentos-resgatados/lancamentos-resgatados.module";
import { PontoAdminController } from "./ponto-admin.controller";
import { PontoAdminService } from "./ponto-admin.service";
import { PontoMotoristaController } from "./ponto.controller";
import { PontoService } from "./ponto.service";

/**
 * O módulo de ponto eletrônico (funcionário CLT).
 *
 * Separado do mensal em tudo — pasta, vocabulário, tabelas e base legal. O
 * único código compartilhado é `common/regime-vigente.ts`, que é justamente a
 * trava que impede a mesma pessoa estar nos dois.
 */
@Module({
  imports: [PrismaModule, LancamentosResgatadosModule],
  controllers: [PontoAdminController, PontoMotoristaController],
  providers: [PontoService, PontoAdminService],
  exports: [PontoService, PontoAdminService],
})
export class PontoModule {}
