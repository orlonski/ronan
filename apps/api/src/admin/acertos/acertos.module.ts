import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import { TagPedagioModule } from "../tag-pedagio/tag-pedagio.module";
import { AcertosController } from "./acertos.controller";
import { AcertosService } from "./acertos.service";
import { AcertoPdfService } from "./acerto-pdf.service";
import { AcertoPublicoController } from "./acerto-publico.controller";

@Module({
  imports: [AuditoriaModule, TagPedagioModule],
  controllers: [AcertosController, AcertoPublicoController],
  providers: [AcertosService, AcertoPdfService],
  exports: [AcertosService, AcertoPdfService],
})
export class AcertosModule {}
