import { Module } from "@nestjs/common";
import { TabelasPrecoController } from "./tabelas-preco.controller";
import { TabelasPrecoService } from "./tabelas-preco.service";
import { PrecificacaoService } from "./precificacao.service";

@Module({
  controllers: [TabelasPrecoController],
  providers: [TabelasPrecoService, PrecificacaoService],
  exports: [TabelasPrecoService, PrecificacaoService],
})
export class TabelasPrecoModule {}
