import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ClickupWebhookController } from "./webhook.controller";
import { FilaExecucoesService } from "./fila.service";
import { WorkerExecucoesService } from "./worker.service";
import { ClickupComentarioService } from "./clickup-comentario.service";
import { RunnerConfig } from "./runner.config";
import { RunnerTokenGuard } from "./runner-token.guard";
import { RateLimitIpGuard } from "./rate-limit-ip.guard";
import { EXECUTOR_AGENTE } from "./executor/executor-agente";
import { StubExecutorAgente } from "./executor/stub.executor";

/**
 * Runner de tasks do ClickUp: webhook → fila no Postgres → worker → comentário
 * de volta na task.
 *
 * A execução do agente fica atrás do token EXECUTOR_AGENTE. Trocar o
 * {@link StubExecutorAgente} por um executor real é a única mudança necessária
 * aqui — webhook, fila, retry e callback não mudam.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ClickupWebhookController],
  providers: [
    RunnerConfig,
    RunnerTokenGuard,
    RateLimitIpGuard,
    FilaExecucoesService,
    ClickupComentarioService,
    WorkerExecucoesService,
    { provide: EXECUTOR_AGENTE, useClass: StubExecutorAgente },
  ],
})
export class ClickupRunnerModule {}
