import { Module } from "@nestjs/common";
import { RoteamentoModule } from "../roteamento/roteamento.module";
import { PedagiosRodoviaModule } from "../admin/pedagios-rodovia/pedagios-rodovia.module";
import {
  ComprovantePessoalPublicoController,
  FretePessoalController,
} from "./frete-pessoal.controller";
import { FretePessoalService } from "./frete-pessoal.service";

/**
 * O trabalho por conta própria do motorista: estimar um frete e comprovar o que
 * rodou. Módulo próprio porque a estimativa vive de roteamento e pedágio — nada
 * a ver com auth, que é onde o resto de `m/eu` mora.
 */
@Module({
  imports: [RoteamentoModule, PedagiosRodoviaModule],
  controllers: [FretePessoalController, ComprovantePessoalPublicoController],
  providers: [FretePessoalService],
})
export class FretePessoalModule {}
