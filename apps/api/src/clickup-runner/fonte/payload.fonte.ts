import { Injectable, Logger } from "@nestjs/common";
import type { ExecucaoAgente } from "@prisma/client";
import { montarComentario } from "../comentario";
import type { ResultadoExecucao } from "../executor/executor-agente";
import type { Demanda, FonteDemanda } from "./fonte-demanda";

/** Primeiro campo string não-vazio entre os candidatos. */
function primeiroTexto(...candidatos: unknown[]): string | undefined {
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

/**
 * Fonte de demanda que vive do próprio corpo do webhook — nada de chamada
 * externa. É como se testa o caminho inteiro (webhook → fila → agente →
 * relato) pelo Postman, sem depender da ferramenta de gestão nem de token.
 *
 * O relato vai pro log em vez de voltar pra algum lugar: quem disparou está
 * olhando o log, e inventar destino aqui seria adivinhação.
 */
@Injectable()
export class PayloadFonteDemanda implements FonteDemanda {
  readonly nome = "payload";
  private readonly logger = new Logger("ClickupRunner");

  async ler(taskId: string, payload: unknown): Promise<Demanda> {
    const p = (payload ?? {}) as Record<string, unknown>;
    const task = (p.task ?? {}) as Record<string, unknown>;

    const titulo = primeiroTexto(p.titulo, p.title, p.name, task.name, task.titulo);
    const descricao = primeiroTexto(
      p.descricao,
      p.description,
      p.text_content,
      task.description,
      task.descricao,
    );

    if (!titulo && !descricao) {
      throw new Error(
        "Payload sem titulo/descricao: mande { \"titulo\": \"…\", \"descricao\": \"…\" } no corpo do webhook.",
      );
    }

    return {
      titulo: titulo ?? `Task ${taskId}`,
      descricao: descricao ?? "",
    };
  }

  async reportar(
    taskId: string,
    resultado: ResultadoExecucao,
    contexto: { job: Pick<ExecucaoAgente, "id" | "taskId" | "tentativas">; duracaoMs: number },
  ): Promise<boolean> {
    this.logger.log(
      JSON.stringify({
        evento: "relato-payload",
        taskId,
        status: resultado.status,
        relato: montarComentario(contexto.job, resultado, contexto.duracaoMs),
      }),
    );
    return true;
  }
}
