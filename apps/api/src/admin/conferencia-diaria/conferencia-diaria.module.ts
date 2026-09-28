import { Module } from "@nestjs/common";
import { ConferenciaDiariaController } from "./conferencia-diaria.controller";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

@Module({
  controllers: [ConferenciaDiariaController],
  providers: [ConferenciaDiariaService],
  exports: [ConferenciaDiariaService],
})
export class ConferenciaDiariaModule {}
