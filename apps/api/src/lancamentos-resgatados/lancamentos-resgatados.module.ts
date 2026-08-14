import { Global, Module } from "@nestjs/common";
import { LancamentosResgatadosService } from "./lancamentos-resgatados.service";

/**
 * Global porque o serviço é chamado de dois lados que não têm relação entre si:
 * os endpoints do motorista (que guardam e fecham casos) e o painel (que lista
 * e resolve). Importar módulo em cada um deles só espalharia ruído.
 */
@Global()
@Module({
  providers: [LancamentosResgatadosService],
  exports: [LancamentosResgatadosService],
})
export class LancamentosResgatadosModule {}
