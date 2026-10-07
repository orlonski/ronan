import { Module } from "@nestjs/common";
import { EmpresasController } from "./empresas.controller";
import { EmpresasService } from "./empresas.service";
import { TabelasPrecoModule } from "../tabelas-preco/tabelas-preco.module";

@Module({
  imports: [TabelasPrecoModule],
  controllers: [EmpresasController],
  providers: [EmpresasService],
})
export class EmpresasModule {}
