import { Module } from "@nestjs/common";
import { EventosController } from "./eventos.controller";
import { EventosService } from "./eventos.service";
import { EventosCleanupService } from "./eventos-cleanup.service";

@Module({
  controllers: [EventosController],
  providers: [EventosService, EventosCleanupService],
  exports: [EventosService],
})
export class EventosModule {}
