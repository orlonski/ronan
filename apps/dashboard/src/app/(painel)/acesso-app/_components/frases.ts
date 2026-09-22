import type { RegraAcessoAppInput } from "@ronan/shared-types";
import type { PainelAcessoApp } from "./tipos";

/**
 * As frases da tela, num lugar só: o cartão do grupo ("Quem entra: …") e a
 * seção "Quem entra em cada grupo" dizem a MESMA coisa com as mesmas palavras.
 */

const QUEM: Record<RegraAcessoAppInput["vinculo"], string> = {
  QUALQUER: "Quem",
  MOTORISTA: "Motorista",
  FUNCIONARIO: "Quem é registrado e bate ponto",
};
const REGIME: Record<RegraAcessoAppInput["regime"], string> = {
  QUALQUER: "",
  PARCEIRO: "que é parceiro (obra e diária)",
  EMPREGADO: "que é registrado em carteira (CLT)",
  NAO_DECLARADO: "que roda só frete comum",
};

/** "Motorista que é registrado em carteira (CLT), da transportadora X". */
export function fraseDaRegra(painel: PainelAcessoApp, r: RegraAcessoAppInput): string {
  const partes = [QUEM[r.vinculo]];
  if (r.regime !== "QUALQUER") partes.push(REGIME[r.regime]);
  const mod = painel.opcoes.modalidades.find((m) => m.id === r.modalidadeId)?.nome;
  if (mod) partes.push(`com vínculo ${mod}`);
  const tr = painel.opcoes.transportadoras.find((t) => t.id === r.transportadoraId)?.nome;
  if (tr) partes.push(`da transportadora ${tr}`);
  const s = partes.join(" ");
  return r.vinculo === "QUALQUER" && r.regime === "QUALQUER" && !mod && !tr ? "Qualquer pessoa" : s;
}

/** Quem cai neste grupo, em frases curtas (vazio = ninguém é mandado pra ele). */
export function quemEntraNoGrupo(painel: PainelAcessoApp, perfilId: string): string[] {
  const out = painel.regras
    .filter((r) => r.ativo && r.perfilId === perfilId)
    .map((r) => fraseDaRegra(painel, r));
  if (painel.perfilPadraoMotoristaId === perfilId) {
    out.push(painel.regras.some((r) => r.ativo) ? "Os outros motoristas" : "Todo motorista");
  }
  if (painel.perfilPadraoFuncionarioId === perfilId) out.push("Quem é registrado em carteira (CLT)");
  return out;
}

export const pessoas = (n: number) => (n === 0 ? "ninguém" : n === 1 ? "1 pessoa" : `${n} pessoas`);
