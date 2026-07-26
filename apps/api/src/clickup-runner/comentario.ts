import type { ExecucaoAgente } from "@prisma/client";
import type { ResultadoExecucao } from "./executor/executor-agente";

const ROTULO: Record<ResultadoExecucao["status"], string> = {
  CONCLUIDA: "✅ Concluída",
  FALHOU: "❌ Falhou",
  EXCEDEU_LIMITE: "⏱️ Excedeu o limite",
};

/**
 * Texto do relato que volta pra task. Fica fora dos providers de propósito:
 * qualquer fonte de demanda (ClickUp hoje, outra amanhã) relata a mesma coisa,
 * e testar formatação não deveria exigir rede.
 */
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
