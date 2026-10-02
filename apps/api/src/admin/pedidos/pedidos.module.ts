import { Module } from "@nestjs/common";
import { PushModule } from "../../push/push.module";
import { UploadsModule } from "../../uploads/uploads.module";
import { AdminInboxModule } from "../inbox/inbox.module";
import { DocumentosVencendoService } from "./documentos-vencendo.service";
import { PedidosController, ProgramacaoController } from "./pedidos.controller";
import { AnexosPedidoController } from "./anexos-pedido.controller";
import { AnexosPedidoService } from "./anexos-pedido.service";
import { PedidoDocumentoService } from "./pedido-documento.service";
import { PedidosService } from "./pedidos.service";
import { ProgramacaoService } from "./programacao.service";

@Module({
  imports: [PushModule, AdminInboxModule, UploadsModule],
  controllers: [PedidosController, ProgramacaoController, AnexosPedidoController],
  providers: [
    PedidosService,
    PedidoDocumentoService,
    ProgramacaoService,
    DocumentosVencendoService,
    AnexosPedidoService,
  ],
  exports: [ProgramacaoService, PedidosService, AnexosPedidoService],
})
export class PedidosModule {}
