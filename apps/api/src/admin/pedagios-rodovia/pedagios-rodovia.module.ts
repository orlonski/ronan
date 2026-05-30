import { Module } from "@nestjs/common";
import { PedagiosRodoviaController } from "./pedagios-rodovia.controller";
import { PedagiosRodoviaService } from "./pedagios-rodovia.service";
import { PedagiosRodoviaConsultaService } from "./pedagios-rodovia-consulta.service";

@Module({
  controllers: [PedagiosRodoviaController],
  providers: [PedagiosRodoviaService, PedagiosRodoviaConsultaService],
  exports: [PedagiosRodoviaService, PedagiosRodoviaConsultaService],
})
export class PedagiosRodoviaModule {}
