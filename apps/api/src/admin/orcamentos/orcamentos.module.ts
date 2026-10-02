import { Module } from "@nestjs/common";
import { RoteamentoModule } from "../../roteamento/roteamento.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { TabelasPrecoModule } from "../tabelas-preco/tabelas-preco.module";
import { OrcamentosController } from "./orcamentos.controller";
import { OrcamentoPublicoController } from "./orcamento-publico.controller";
import { OrcamentosService } from "./orcamentos.service";
import { OrcamentoPdfService } from "./orcamento-pdf.service";

@Module({
  imports: [RoteamentoModule, UploadsModule, TabelasPrecoModule],
  controllers: [OrcamentosController, OrcamentoPublicoController],
  providers: [OrcamentosService, OrcamentoPdfService],
})
export class OrcamentosModule {}
