import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { PrismaModule } from "../../prisma/prisma.module";
import { AcessoAppService } from "./acesso-app.service";
import { CapacidadesBootCheck } from "./capacidades.boot-check";

/**
 * O acesso do app calculado. Global porque, a partir da fase seguinte, todo
 * ponto que muda algo que decide acesso (regime, cadastro, módulo) chama o
 * recálculo — e esses pontos estão espalhados por meia dúzia de módulos.
 */
@Global()
@Module({
  imports: [PrismaModule, DiscoveryModule],
  // O boot-check mora aqui: é quem conhece o catálogo de capacidades.
  providers: [AcessoAppService, CapacidadesBootCheck],
  exports: [AcessoAppService],
})
export class AcessoAppModule {}
