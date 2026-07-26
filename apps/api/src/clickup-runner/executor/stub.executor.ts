import { Injectable } from "@nestjs/common";
import type { ContextoExecucao, ExecutorAgente, ResultadoExecucao } from "./executor-agente";

/**
 * Executor que NÃO roda agente nenhum — é o padrão enquanto a infra de execução
 * isolada não existe. Serve pra fechar o circuito de ponta a ponta (webhook →
 * fila → worker → comentário na task) sem dar à API a capacidade de executar
 * código e mexer no repositório.
 *
 * Devolve FALHOU sem `falhaInfra`: não retenta (não adianta tentar de novo o
 * que não está configurado) e ainda assim comenta na task — silêncio seria o
 * pior resultado.
 */
@Injectable()
export class StubExecutorAgente implements ExecutorAgente {
  readonly nome = "stub";

  async executar(ctx: ContextoExecucao): Promise<ResultadoExecucao> {
    return {
      status: "FALHOU",
      resumo:
        "A execução automática ainda não está plugada neste ambiente (executor=stub). " +
        `Demanda lida: **${ctx.demanda.titulo}**` +
        (ctx.demanda.descricao ? ` (${ctx.demanda.descricao.length} caracteres de descrição).` : " (sem descrição).") +
        " O webhook foi recebido, autenticado e enfileirado corretamente, e esta task " +
        `seria trabalhada na branch \`${ctx.branch}\` com teto de ` +
        `${Math.round(ctx.timeoutMs / 60_000)} min e US$ ${ctx.orcamentoUsd.toFixed(2)}. ` +
        "Pra ligar de verdade, registre um ExecutorAgente real no token EXECUTOR_AGENTE.",
      branch: ctx.branch,
      falhaInfra: false,
    };
  }
}
