import { Module } from "@nestjs/common";
import { PushModule } from "../../push/push.module";
import { PedidosController, ProgramacaoController } from "./pedidos.controller";
import { PedidosService } from "./pedidos.service";
import { ProgramacaoService } from "./programacao.service";

@Module({
  imports: [PushModule],
  controllers: [PedidosController, ProgramacaoController],
  providers: [PedidosService, ProgramacaoService],
  exports: [ProgramacaoService],
})
export class PedidosModule {}
