import { Module } from "@nestjs/common";
import { RoteamentoService } from "./roteamento.service";
import { NavegacaoService } from "./navegacao.service";
import { RotaCacheLimpezaService } from "./rota-cache-limpeza.service";

@Module({
  providers: [RoteamentoService, NavegacaoService, RotaCacheLimpezaService],
  exports: [RoteamentoService, NavegacaoService],
})
export class RoteamentoModule {}
