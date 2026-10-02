import { Module } from "@nestjs/common";
import { TabelasPrecoController } from "./tabelas-preco.controller";
import { TabelasPrecoService } from "./tabelas-preco.service";
import { PrecificacaoService } from "./precificacao.service";
import { SobretaxaCombustivelController } from "./sobretaxa-combustivel.controller";
import { SobretaxaCombustivelService } from "./sobretaxa-combustivel.service";

@Module({
  controllers: [TabelasPrecoController, SobretaxaCombustivelController],
  providers: [TabelasPrecoService, PrecificacaoService, SobretaxaCombustivelService],
  exports: [TabelasPrecoService, PrecificacaoService],
})
export class TabelasPrecoModule {}
