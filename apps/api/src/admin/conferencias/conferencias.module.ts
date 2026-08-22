import { Module } from "@nestjs/common";
import { ConferenciaTicketModule } from "../../conferencia-ticket/conferencia-ticket.module";
import { ConferenciasController } from "./conferencias.controller";

@Module({
  imports: [ConferenciaTicketModule],
  controllers: [ConferenciasController],
})
export class ConferenciasModule {}
