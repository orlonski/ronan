import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { FilaExecucoesService } from "./fila.service";
import { RateLimitIpGuard, ipDaRequisicao } from "./rate-limit-ip.guard";
import { RunnerTokenGuard } from "./runner-token.guard";

/** Extrai o task_id da query ou, como plano B, do payload da Automation. */
export function extrairTaskId(query: unknown, body: unknown): string | undefined {
  const daQuery = (query as { task_id?: unknown })?.task_id;
  if (typeof daQuery === "string" && daQuery.trim()) return daQuery.trim();

  const corpo = body as { task_id?: unknown; id?: unknown; payload?: { id?: unknown } } | undefined;
  for (const candidato of [corpo?.task_id, corpo?.id, corpo?.payload?.id]) {
    if (typeof candidato === "string" && candidato.trim()) return candidato.trim();
  }
  return undefined;
}

/**
 * Webhook da Automation do ClickUp.
 *
 * Só valida, persiste e enfileira — a execução acontece no worker. O handler
 * não faz nada pesado de propósito: o ClickUp reenvia em timeout, e reenvio é
 * exatamente o que a fila precisa evitar.
 *
 * Fora do Swagger (`@ApiExcludeController`): documentar publicamente um
 * endpoint que dispara execução não ajuda ninguém além de quem procura.
 */
@ApiExcludeController()
@Controller()
export class ClickupWebhookController {
  private readonly logger = new Logger("ClickupRunner");

  constructor(private readonly fila: FilaExecucoesService) {}

  // @Public() = fora do JwtAuthGuard global (a API inteira exige JWT por
  // padrão). Quem chama é máquina do ClickUp, não usuário logado: a
  // autenticação aqui é o segredo compartilhado do RunnerTokenGuard.
  @Public()
  @UseGuards(RateLimitIpGuard, RunnerTokenGuard)
  @HttpCode(200)
  // A 2ª rota é o path não-adivinhável (CLICKUP_RUNNER_PATH_SEGREDO); o guard
  // exige o segmento quando ele está configurado e recusa quando não está.
  @Post(["clickup/task-ready", ":segredo/clickup/task-ready"])
  async taskReady(
    @Query() query: Record<string, string>,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const taskId = extrairTaskId(query, body);
    if (!taskId) throw new BadRequestException("task_id é obrigatório");

    const resultado = await this.fila.enfileirar({
      taskId,
      payload: body,
      origemIp: ipDaRequisicao(req),
    });

    if (!resultado.aceito) {
      this.logger.log(
        JSON.stringify({
          evento: "recebido-duplicado",
          taskId,
          motivo: resultado.motivo,
          jobId: resultado.jobExistente.id,
        }),
      );
      throw new ConflictException(
        resultado.motivo === "execucao-ativa"
          ? "Já existe execução ativa para esta task"
          : "Execução recente para esta task (janela de dedupe)",
      );
    }

    this.logger.log(
      JSON.stringify({ evento: "recebido", taskId, jobId: resultado.job.id }),
    );
    return { status: "enfileirado", jobId: resultado.job.id, taskId };
  }
}
