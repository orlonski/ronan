import { Module } from "@nestjs/common";
import { RoteamentoModule } from "../roteamento/roteamento.module";
import { KmAtipicoService } from "./km-atipico.service";

@Module({
  imports: [RoteamentoModule],
  providers: [KmAtipicoService],
  exports: [KmAtipicoService],
})
export class KmAtipicoModule {}
