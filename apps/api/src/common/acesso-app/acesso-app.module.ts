import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AcessoAppService } from "./acesso-app.service";

/**
 * O acesso do app calculado. Global porque, a partir da fase seguinte, todo
 * ponto que muda algo que decide acesso (regime, cadastro, módulo) chama o
 * recálculo — e esses pontos estão espalhados por meia dúzia de módulos.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AcessoAppService],
  exports: [AcessoAppService],
})
export class AcessoAppModule {}
