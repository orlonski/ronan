import type { ExecucaoAgente } from "@prisma/client";
import type { ResultadoExecucao } from "../executor/executor-agente";

/**
 * De onde vem a demanda e pra onde volta o resultado.
 *
 * Existe porque a ferramenta de gestão ainda está em avaliação: trocar ClickUp
 * por outra coisa (ou por um payload cru vindo do Postman) tem que ser
 * registrar outro provider, não reescrever worker, fila e webhook.
 */

/** O que o agente precisa saber pra trabalhar a task. */
export type Demanda = {
  titulo: string;
  descricao: string;
  /** Link pra task, quando a fonte tiver um. Só pra log/comentário. */
  url?: string;
};

export interface FonteDemanda {
  /** Nome curto pro log (ex.: "clickup", "payload"). */
  readonly nome: string;

  /**
   * Lê título e descrição da task.
   *
   * Recebe o `payload` do webhook além do id porque o provider `payload` vive
   * exatamente dele — a assinatura só com `taskId` não daria conta de testar
   * sem a ferramenta externa no meio.
   *
   * Falhar aqui é falha de INFRA (ferramenta fora do ar): o worker reagenda.
   */
  ler(taskId: string, payload: unknown): Promise<Demanda>;

  /**
   * Reporta o desfecho na task. Devolve `false` quando não conseguiu reportar
   * — o worker registra, mas não retenta a execução por isso (o trabalho já
   * foi feito; repetir sairia caro e duplicaria efeito).
   */
  reportar(
    taskId: string,
    resultado: ResultadoExecucao,
    contexto: { job: Pick<ExecucaoAgente, "id" | "taskId" | "tentativas">; duracaoMs: number },
  ): Promise<boolean>;
}

export const FONTE_DEMANDA = Symbol("FONTE_DEMANDA");
