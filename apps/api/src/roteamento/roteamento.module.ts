import { Module } from "@nestjs/common";
import { RoteamentoService } from "./roteamento.service";
import { NavegacaoService } from "./navegacao.service";

@Module({
  providers: [RoteamentoService, NavegacaoService],
  exports: [RoteamentoService, NavegacaoService],
})
export class RoteamentoModule {}
