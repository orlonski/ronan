import { Module } from "@nestjs/common";
import { UploadsModule } from "../../uploads/uploads.module";
import { RoteamentoModule } from "../../roteamento/roteamento.module";
import { GeocodingModule } from "../../geocoding/geocoding.module";
import { PedagiosRodoviaModule } from "../pedagios-rodovia/pedagios-rodovia.module";
import { TabelasPrecoModule } from "../tabelas-preco/tabelas-preco.module";
import { TagPedagioController } from "./tag-pedagio.controller";
import { TagPedagioService } from "./tag-pedagio.service";
import { TagProcessamentoService } from "./tag-processamento.service";

/** Conferência da tag de pedágio (módulo contratado `tag-pedagio`, Onda 1: só servidor + painel). */
@Module({
  imports: [UploadsModule, RoteamentoModule, GeocodingModule, PedagiosRodoviaModule, TabelasPrecoModule],
  controllers: [TagPedagioController],
  providers: [TagPedagioService, TagProcessamentoService],
  exports: [TagProcessamentoService],
})
export class TagPedagioModule {}
