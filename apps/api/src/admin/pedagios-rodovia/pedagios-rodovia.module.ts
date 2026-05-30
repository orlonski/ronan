import { Module } from "@nestjs/common";
import { PedagiosRodoviaController } from "./pedagios-rodovia.controller";
import { PedagiosRodoviaService } from "./pedagios-rodovia.service";

@Module({
  controllers: [PedagiosRodoviaController],
  providers: [PedagiosRodoviaService],
  exports: [PedagiosRodoviaService],
})
export class PedagiosRodoviaModule {}
