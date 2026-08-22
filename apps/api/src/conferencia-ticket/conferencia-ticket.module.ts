import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ConferenciaConfig } from "./conferencia.config";
import { ConferenciaFilaService } from "./conferencia-fila.service";

/**
 * Só a FILA — sem worker. É o que a API importa pra poder enfileirar do
 * lançamento do motorista e ler o resumo no painel.
 *
 * A separação espelha `clickup-runner.module.ts` × `agente-worker.module.ts`:
 * quem enfileira e quem consome são módulos diferentes, então mover o worker
 * pra um processo próprio depois é trocar o entrypoint, não reescrever.
 */
@Module({
  imports: [PrismaModule],
  providers: [ConferenciaConfig, ConferenciaFilaService],
  exports: [ConferenciaFilaService, ConferenciaConfig],
})
export class ConferenciaTicketModule {}
