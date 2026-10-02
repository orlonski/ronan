import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import { AcertosController } from "./acertos.controller";
import { AcertosService } from "./acertos.service";
import { AcertoPdfService } from "./acerto-pdf.service";
import { AcertoPublicoController } from "./acerto-publico.controller";

@Module({
  imports: [AuditoriaModule],
  controllers: [AcertosController, AcertoPublicoController],
  providers: [AcertosService, AcertoPdfService],
  exports: [AcertosService, AcertoPdfService],
})
export class AcertosModule {}
