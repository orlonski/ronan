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
  // A fila sai do módulo porque o marketing também abre demanda: a pauta
  // semanal do Instagram escreve na MESMA fila que o webhook, pra o agente não
  // precisar saber de onde o pedido veio.
  //
  // `RunnerConfig` sai junto pelo mesmo motivo: quem enfileira precisa saber
  // quanto tempo de execução pedir, e o teto é do runner, não de quem chama.
  // Sem exportar, `PautaService` não resolve a dependência e a API NÃO SOBE —
  // o boot morre em "Nest can't resolve dependencies of the PautaService".
  exports: [FilaExecucoesService, RunnerConfig],
})
export class ClickupRunnerModule implements OnModuleInit {
  constructor(private readonly config: RunnerConfig) {}

  onModuleInit(): void {
    this.config.descreverNoBoot("webhook");
  }
}
