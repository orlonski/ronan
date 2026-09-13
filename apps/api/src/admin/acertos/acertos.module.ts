import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import { AcertosController } from "./acertos.controller";
import { AcertosService } from "./acertos.service";

@Module({
  imports: [AuditoriaModule],
  controllers: [AcertosController],
  providers: [AcertosService],
  exports: [AcertosService],
})
export class AcertosModule {}
