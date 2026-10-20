import { Module } from "@nestjs/common";
import { ConferenciaTicketModule } from "../../conferencia-ticket/conferencia-ticket.module";
import { ConferenciasController } from "./conferencias.controller";
import { EscritorioInterruptorController } from "./escritorio-interruptor.controller";

@Module({
  imports: [ConferenciaTicketModule],
  controllers: [ConferenciasController, EscritorioInterruptorController],
})
export class ConferenciasModule {}
