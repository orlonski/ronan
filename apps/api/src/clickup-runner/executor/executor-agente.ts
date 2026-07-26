import type { Demanda } from "../fonte/fonte-demanda";

/**
 * Contrato de execução do agente sobre uma task.
 *
 * A execução de verdade (git worktree + `claude -p` headless) fica ATRÁS desta
 * interface de propósito: a API da transportadora atende motorista e painel, e
 * não deve ganhar a capacidade de rodar agente / escrever no repo sem uma
 * decisão explícita de infra. Hoje o provider registrado é o
 * {@link StubExecutorAgente}; trocar de executor é registrar outro provider com
 * o token EXECUTOR_AGENTE no módulo, sem tocar em webhook, fila ou callback.
 */

/** O que o worker entrega pro executor. */
export type ContextoExecucao = {
  jobId: string;
  taskId: string;
  /** Título e descrição, já lidos pela FonteDemanda — é o enunciado do trabalho. */
  demanda: Demanda;
  /** Payload cru da Automation do ClickUp. */
  payload: unknown;
  /** Branch que a execução deve usar (nunca a principal). */
  branch: string;
  /** Teto duro de tempo. Estourar = EXCEDEU_LIMITE, não falha de infra. */
  timeoutMs: number;
  /** Teto de gasto da execução, em dólares. */
  orcamentoUsd: number;
  /** Tentativa atual (1 na primeira). */
  tentativa: number;
};

export type StatusResultado = "CONCLUIDA" | "FALHOU" | "EXCEDEU_LIMITE";

/** O que o executor devolve pro worker (vira o comentário na task). */
export type ResultadoExecucao = {
  status: StatusResultado;
  /** Texto pro comentário na task: o que foi feito (ou por que não foi). */
  resumo: string;
  arquivosAlterados?: string[];
  branch?: string;
  custoUsd?: number;
  exitCode?: number;
  /**
   * true = falhou por INFRA (rede, container, git indisponível) → vale
   * retentar com backoff. Falha do próprio agente é resultado, não defeito:
   * não retenta, só comenta.
   */
  falhaInfra?: boolean;
};

export interface ExecutorAgente {
  /** Nome curto pro log/comentário (ex.: "stub", "claude-code"). */
  readonly nome: string;
  executar(ctx: ContextoExecucao): Promise<ResultadoExecucao>;
}

export const EXECUTOR_AGENTE = Symbol("EXECUTOR_AGENTE");
