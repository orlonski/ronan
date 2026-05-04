import { Module } from "@nestjs/common";
import { RoteamentoService } from "./roteamento.service";

@Module({
  providers: [RoteamentoService],
  exports: [RoteamentoService],
})
export class RoteamentoModule {}
