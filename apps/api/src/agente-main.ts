import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AgenteWorkerModule } from "./clickup-runner/agente-worker.module";

/**
 * Entrypoint do serviço `ronan_agente`: só o worker da fila, sem HTTP.
 *
 * Compartilha o código da API (mesmo build, mesmo Prisma Client) mas roda em
 * container próprio — quem recebe webhook e quem executa são processos
 * diferentes de propósito.
 *
 * NÃO roda `prisma migrate deploy`: quem versiona o banco é a API. Dois
 * processos aplicando migration no boot brigariam por lock à toa.
 *
 * Sobre multi-empresa: este processo NÃO abre contexto de conta, e está certo.
 * A fila (`ExecucaoAgente`) é da plataforma, não de nenhuma empresa — é o Diego
 * mandando task pro agente —, então a trava passa direto por ela. Se um dia o
 * worker precisar tocar dado de negócio, aí sim terá que rodar dentro de
 * `comConta` da empresa dona da demanda.
 */
async function bootstrap() {
  const logger = new Logger("Agente");

  // O Claude Code autentica por CLAUDE_CODE_OAUTH_TOKEN neste serviço. Com
  // ANTHROPIC_API_KEY no ambiente ele usaria a chave de API (outra conta, outra
  // cobrança) sem avisar — então a chave é removida do processo, não só
  // ignorada. O entrypoint do container também faz `unset`; isto aqui é a
  // segunda barreira, pra valer inclusive rodando fora do Docker.
  if (process.env.ANTHROPIC_API_KEY) {
    delete process.env.ANTHROPIC_API_KEY;
    logger.warn(
      "ANTHROPIC_API_KEY estava setada no ambiente do agente e foi removida do processo. " +
        "A autenticação aqui é por CLAUDE_CODE_OAUTH_TOKEN.",
    );
  }

  const app = await NestFactory.createApplicationContext(AgenteWorkerModule);
  app.enableShutdownHooks();

  logger.log("Agente de tasks iniciado (sem HTTP; só consome a fila).");
}

bootstrap();
