import { Module } from "@nestjs/common";
import { PushModule } from "../../push/push.module";
import { AdminInboxModule } from "../inbox/inbox.module";
import { DocumentosVencendoService } from "./documentos-vencendo.service";
import { PedidosController, ProgramacaoController } from "./pedidos.controller";
import { PedidosService } from "./pedidos.service";
import { ProgramacaoService } from "./programacao.service";

@Module({
  imports: [PushModule, AdminInboxModule],
  controllers: [PedidosController, ProgramacaoController],
  providers: [PedidosService, ProgramacaoService, DocumentosVencendoService],
  exports: [ProgramacaoService, PedidosService],
})
export class PedidosModule {}
