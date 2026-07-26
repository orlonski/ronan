import { Injectable, Logger } from "@nestjs/common";
import type { ExecucaoAgente } from "@prisma/client";
import { RunnerConfig } from "../runner.config";
import { montarComentario } from "../comentario";
import type { ResultadoExecucao } from "../executor/executor-agente";
import type { Demanda, FonteDemanda } from "./fonte-demanda";

type TaskClickup = {
  id?: string;
  name?: string;
  description?: string;
  text_content?: string;
  url?: string;
};

/** Fonte de demanda no ClickUp: lê a task na API v2 e relata por comentário. */
@Injectable()
export class ClickupFonteDemanda implements FonteDemanda {
  readonly nome = "clickup";
  private readonly logger = new Logger("ClickupRunner");

  constructor(private readonly config: RunnerConfig) {}

  /** O payload do webhook é ignorado aqui: a verdade é a task na API. */
  async ler(taskId: string, _payload?: unknown): Promise<Demanda> {
    if (!this.config.clickupToken) {
      throw new Error("CLICKUP_API_TOKEN não configurado — não dá pra ler a task.");
    }

    const res = await this.buscar(`/task/${encodeURIComponent(taskId)}`);
    if (!res.ok) {
      const corpo = await res.text().catch(() => "");
      throw new Error(`ClickUp devolveu ${res.status} ao ler a task: ${corpo.slice(0, 200)}`);
    }
    const task = (await res.json()) as TaskClickup;

    // `description` é o markdown; `text_content` é o mesmo texto sem formatação.
    // Task sem descrição é normal (título já é demanda), então não é erro.
    return {
      titulo: task.name?.trim() || `Task ${taskId}`,
      descricao: (task.description ?? task.text_content ?? "").trim(),
      url: task.url,
    };
  }

  async reportar(
    taskId: string,
    resultado: ResultadoExecucao,
    contexto: { job: Pick<ExecucaoAgente, "id" | "taskId" | "tentativas">; duracaoMs: number },
  ): Promise<boolean> {
    const texto = montarComentario(contexto.job, resultado, contexto.duracaoMs);

    if (!this.config.clickupToken) {
      this.logger.warn(
        JSON.stringify({ evento: "relato-sem-token", taskId, tamanho: texto.length }),
      );
      return false;
    }

    // Duas tentativas: ficar sem relato é o pior desfecho, mas insistir demais
    // também não ajuda — depois disso o texto vai pro log de erro.
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        const res = await this.buscar(`/task/${encodeURIComponent(taskId)}/comment`, {
          method: "POST",
          body: JSON.stringify({ comment_text: texto, notify_all: false }),
        });
        if (res.ok) return true;
        const corpo = await res.text().catch(() => "");
        this.logger.warn(
          JSON.stringify({
            evento: "relato-recusado",
            taskId,
            tentativa,
            status: res.status,
            corpo: corpo.slice(0, 300),
          }),
        );
      } catch (err) {
        this.logger.warn(
          JSON.stringify({
            evento: "relato-erro",
            taskId,
            tentativa,
            erro: (err as Error).message,
          }),
        );
      }
      if (tentativa === 1) await new Promise((r) => setTimeout(r, 2_000));
    }

    this.logger.error(
      JSON.stringify({ evento: "relato-desistiu", taskId, texto: texto.slice(0, 1_000) }),
    );
    return false;
  }

  private async buscar(caminho: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    return fetch(`${this.config.clickupApiUrl}${caminho}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: this.config.clickupToken,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }
}
