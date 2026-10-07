import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { TabelasPrecoModule } from "../tabelas-preco/tabelas-preco.module";
import { ImportacaoController } from "./importacao.controller";
import { ImportacaoService } from "./importacao.service";

@Module({
  imports: [AuthModule, TabelasPrecoModule],
  controllers: [ImportacaoController],
  providers: [ImportacaoService],
})
export class ImportacaoModule {}
