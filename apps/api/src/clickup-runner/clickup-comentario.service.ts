import { Injectable, Logger } from "@nestjs/common";
import type { ExecucaoAgente } from "@prisma/client";
import { RunnerConfig } from "./runner.config";
import type { ResultadoExecucao } from "./executor/executor-agente";

const ROTULO: Record<ResultadoExecucao["status"], string> = {
  CONCLUIDA: "✅ Concluída",
  FALHOU: "❌ Falhou",
  EXCEDEU_LIMITE: "⏱️ Excedeu o limite",
};

/** Monta o texto do comentário. Separado do envio pra poder testar sem rede. */
export function montarComentario(
  job: Pick<ExecucaoAgente, "id" | "taskId" | "tentativas">,
  resultado: ResultadoExecucao,
  duracaoMs: number,
): string {
  const linhas: string[] = [`**${ROTULO[resultado.status]}** — execução automática`, ""];
  linhas.push(resultado.resumo.trim(), "");

  const arquivos = resultado.arquivosAlterados ?? [];
  if (arquivos.length > 0) {
    linhas.push("**Arquivos alterados**");
    for (const arquivo of arquivos.slice(0, 40)) linhas.push(`- \`${arquivo}\``);
    if (arquivos.length > 40) linhas.push(`- …e mais ${arquivos.length - 40}`);
    linhas.push("");
  } else if (resultado.status === "CONCLUIDA") {
    linhas.push("**Arquivos alterados:** nenhum", "");
  }

  if (resultado.branch) linhas.push(`**Branch:** \`${resultado.branch}\``);
  linhas.push(`**Duração:** ${(duracaoMs / 1000).toFixed(1)}s`);
  if (resultado.custoUsd != null) linhas.push(`**Custo:** US$ ${resultado.custoUsd.toFixed(2)}`);
  if (resultado.exitCode != null) linhas.push(`**Exit code:** ${resultado.exitCode}`);
  if (job.tentativas > 0) linhas.push(`**Tentativas:** ${job.tentativas + 1}`);
  linhas.push(`**Execução:** \`${job.id}\``);

  return linhas.join("\n");
}

/**
 * Publica o resultado de volta na task (API v2 do ClickUp). Falhar aqui é o
 * pior desfecho possível — a task fica sem notícia nenhuma — então tem retry
 * curto e, se ainda assim falhar, vira log de erro com o texto que era pra ir.
 */
@Injectable()
export class ClickupComentarioService {
  private readonly logger = new Logger("ClickupRunner");

  constructor(private readonly config: RunnerConfig) {}

  async comentar(taskId: string, texto: string): Promise<boolean> {
    if (!this.config.clickupToken) {
      this.logger.warn(
        JSON.stringify({ evento: "comentario-sem-token", taskId, tamanho: texto.length }),
      );
      return false;
    }

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(
          `${this.config.clickupApiUrl}/task/${encodeURIComponent(taskId)}/comment`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: this.config.clickupToken,
            },
            body: JSON.stringify({ comment_text: texto, notify_all: false }),
            signal: controller.signal,
          },
        ).finally(() => clearTimeout(timer));

        if (res.ok) return true;
        const corpo = await res.text().catch(() => "");
        this.logger.warn(
          JSON.stringify({
            evento: "comentario-recusado",
            taskId,
            tentativa,
            status: res.status,
            corpo: corpo.slice(0, 300),
          }),
        );
      } catch (err) {
        this.logger.warn(
          JSON.stringify({
            evento: "comentario-erro",
            taskId,
            tentativa,
            erro: (err as Error).message,
          }),
        );
      }
      if (tentativa === 1) await new Promise((r) => setTimeout(r, 2_000));
    }

    this.logger.error(
      JSON.stringify({ evento: "comentario-desistiu", taskId, texto: texto.slice(0, 1_000) }),
    );
    return false;
  }
}
