import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { FilaExecucoesService } from "./fila.service";
import { WorkerExecucoesService } from "./worker.service";
import { ClickupComentarioService } from "./clickup-comentario.service";
import { RunnerConfig } from "./runner.config";
import { EXECUTOR_AGENTE, type ExecutorAgente } from "./executor/executor-agente";
import { StubExecutorAgente } from "./executor/stub.executor";

/**
 * Escolhe o executor pela env `EXECUTOR_AGENTE`. Nome desconhecido é erro de
 * boot, não silêncio: subir o agente achando que o executor real está ligado
 * quando na verdade caiu num fallback é justamente o engano caro.
 */
export function criarExecutor(config: RunnerConfig): ExecutorAgente {
  switch (config.executor) {
    case "stub":
      return new StubExecutorAgente();
    default:
      throw new Error(
        `EXECUTOR_AGENTE="${config.executor}" desconhecido. Valores aceitos: stub.`,
      );
  }
}

/**
 * Processo do AGENTE (`ronan_agente`): consome a fila e executa. Não sobe HTTP
 * — é um contexto Nest sem servidor, ver `agente-main.ts`.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [
    RunnerConfig,
    FilaExecucoesService,
    ClickupComentarioService,
    WorkerExecucoesService,
    { provide: EXECUTOR_AGENTE, useFactory: criarExecutor, inject: [RunnerConfig] },
  ],
})
export class AgenteWorkerModule {}
