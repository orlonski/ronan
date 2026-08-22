import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { UploadsModule } from "../uploads/uploads.module";
import { PushModule } from "../push/push.module";
import { ConferenciaConfig } from "./conferencia.config";
import { ConferenciaFilaService } from "./conferencia-fila.service";
import { ConferenciaWorkerService } from "./conferencia-worker.service";
import { LeitorTicketService } from "./leitor-ticket.service";
import { AplicarVereditoService } from "./aplicar-veredito.service";

/**
 * Fila + worker. É este que faz o laço rodar.
 *
 * Hoje sobe junto com a API (a conferência é uma chamada HTTP e uma escrita no
 * banco — não precisa de container próprio como o agente, que executa código).
 * Se um dia o volume pedir isolamento, este módulo vira o entrypoint de um
 * processo separado sem mudar mais nada.
 */
@Module({
  imports: [PrismaModule, UploadsModule, PushModule],
  providers: [
    ConferenciaConfig,
    ConferenciaFilaService,
    LeitorTicketService,
    AplicarVereditoService,
    ConferenciaWorkerService,
  ],
  exports: [ConferenciaFilaService],
})
export class ConferenciaWorkerModule {}
