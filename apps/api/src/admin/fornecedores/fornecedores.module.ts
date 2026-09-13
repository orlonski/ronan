import { Module } from "@nestjs/common";
import { CustosVeiculoController, FornecedoresController } from "./fornecedores.controller";
import { FornecedoresService } from "./fornecedores.service";

@Module({
  controllers: [FornecedoresController, CustosVeiculoController],
  providers: [FornecedoresService],
  exports: [FornecedoresService],
})
export class FornecedoresModule {}
