import { Module } from "@nestjs/common";
import { LocaisImagemModule } from "../../locais-imagem/locais-imagem.module";
import { KmAtipicoModule } from "../../km-atipico/km-atipico.module";
import { PedidosModule } from "../pedidos/pedidos.module";
import { LocaisController } from "./locais.controller";
import { LocaisService } from "./locais.service";

@Module({
  imports: [LocaisImagemModule, KmAtipicoModule, PedidosModule],
  controllers: [LocaisController],
  providers: [LocaisService],
})
export class LocaisModule {}
