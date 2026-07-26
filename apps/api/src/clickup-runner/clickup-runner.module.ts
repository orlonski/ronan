import { Module, OnModuleInit } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ClickupWebhookController } from "./webhook.controller";
import { FilaExecucoesService } from "./fila.service";
import { RunnerConfig } from "./runner.config";
import { RunnerTokenGuard } from "./runner-token.guard";
import { RateLimitIpGuard } from "./rate-limit-ip.guard";

/**
 * Lado WEBHOOK do runner, que roda dentro da API: recebe a chamada da
 * Automation, autentica, deduplica e **enfileira**. Só isso.
 *
 * Quem consome a fila é o serviço do agente (`agente-main.ts` +
 * {@link AgenteWorkerModule}), num container separado. A API não registra o
 * worker de propósito: deploy/reinício dela não pode interromper execução em
 * andamento, e o container que atende motorista e painel não deve ganhar a
 * capacidade de executar código e mexer no repositório.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ClickupWebhookController],
  providers: [RunnerConfig, RunnerTokenGuard, RateLimitIpGuard, FilaExecucoesService],
})
export class ClickupRunnerModule implements OnModuleInit {
  constructor(private readonly config: RunnerConfig) {}

  onModuleInit(): void {
    this.config.descreverNoBoot("webhook");
  }
}
