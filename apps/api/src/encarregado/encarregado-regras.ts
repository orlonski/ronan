import { createHash, randomBytes, randomInt } from "node:crypto";
import type { StatusViagemPlanejada } from "@prisma/client";
import { telefoneDiscavel } from "@ronan/shared-types";

/**
 * As regras puras do portal da obra: código de entrada, sessão e o que a obra
 * pode ver. Sem banco aqui — é o que os specs cobrem.
 */

export const CODIGO_TTL_MIN = 10;
export const CODIGO_MAX_TENTATIVAS = 5;
export const CODIGO_REENVIO_S = 60;
/** Sessão longa: o encarregado abre o portal do celular todo dia, sem senha. */
export const SESSAO_DIAS = 30;
/** Prefixo do token: deixa óbvio em log/suporte que não é um JWT do painel. */
export const PREFIXO_TOKEN = "obra_";

/**
 * O celular do encarregado como guardamos: 11 dígitos, DDD + 9 + número, sem o
 * 55. Aceita o que a pessoa digitar (com máscara, com 55, sem o nono dígito) —
 * e devolve `null` quando não é celular, pra recusar antes de mandar código.
 */
export function normalizarTelefoneEncarregado(input: string): string | null {
  const d = telefoneDiscavel(input);
  // Fixo não recebe WhatsApp de código: só celular (11 dígitos) serve.
  return d && d.length === 11 ? d : null;
}

export function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * SHA-256 de um segredo (código ou token). Código de 6 dígitos com hash não
 * resiste a força bruta offline — não é esse o ponto: o ponto é que quem lê a
 * tabela (backup, suporte, log de query) não vê o código vivo pra digitar.
 */
export function hashSegredo(segredo: string): string {
  return createHash("sha256").update(segredo).digest("hex");
}

/** 32 bytes = 256 bits. Quem tem o token É o encarregado, então entropia é tudo. */
export function gerarTokenSessao(): string {
  return `${PREFIXO_TOKEN}${randomBytes(32).toString("base64url")}`;
}

export type CodigoPendente = {
  codigoHash: string;
  expiraEm: Date;
  tentativas: number;
};

export type ResultadoCodigo =
  | { ok: true }
  | { ok: false; motivo: "SEM_CODIGO" | "VENCIDO" | "TENTATIVAS" | "ERRADO" };

/**
 * Decide se o código digitado vale. A ORDEM importa: estourou as tentativas,
 * nem compara — senão a 6ª tentativa certa entraria, e o limite de 5 viraria
 * enfeite pra quem está chutando.
 */
export function avaliarCodigo(
  pendente: CodigoPendente | null,
  digitado: string,
  agora: Date = new Date(),
): ResultadoCodigo {
  if (!pendente) return { ok: false, motivo: "SEM_CODIGO" };
  if (pendente.expiraEm.getTime() <= agora.getTime()) return { ok: false, motivo: "VENCIDO" };
  if (pendente.tentativas >= CODIGO_MAX_TENTATIVAS) return { ok: false, motivo: "TENTATIVAS" };
  if (hashSegredo(digitado) !== pendente.codigoHash) return { ok: false, motivo: "ERRADO" };
  return { ok: true };
}

export const MENSAGEM_CODIGO: Record<Exclude<ResultadoCodigo, { ok: true }>["motivo"], string> = {
  SEM_CODIGO: "Esse código não vale mais. Peça um novo.",
  VENCIDO: "O código venceu. Peça um novo.",
  TENTATIVAS: "Tentativas demais. Peça um novo código.",
  ERRADO: "Código errado. Confira no WhatsApp.",
};

/** Já dá pra mandar outro código? (1 minuto entre envios pro mesmo número.) */
export function podeReenviar(ultimoEnvio: Date | null, agora: Date = new Date()): boolean {
  if (!ultimoEnvio) return true;
  return agora.getTime() - ultimoEnvio.getTime() >= CODIGO_REENVIO_S * 1000;
}

export type SessaoParaValidar = {
  expiraEm: Date;
  revogadaEm: Date | null;
  encarregado: { ativo: boolean; cliente: { ativa: boolean } };
};

/**
 * A sessão ainda abre o portal? Fail-closed: qualquer coisa fora do lugar
 * (revogada, vencida, encarregado desativado, obra encerrada) é NÃO.
 */
export function sessaoValida(s: SessaoParaValidar | null, agora: Date = new Date()): boolean {
  if (!s) return false;
  if (s.revogadaEm) return false;
  if (s.expiraEm.getTime() <= agora.getTime()) return false;
  if (!s.encarregado.ativo) return false;
  if (!s.encarregado.cliente.ativa) return false;
  return true;
}

/**
 * O status do quadro em linguagem de cliente. "Enviada ao motorista" e "No
 * quadro" são conversa interna da transportadora; pra obra, é "programado" ou
 * "confirmado pelo motorista".
 */
export function situacaoParaObra(status: StatusViagemPlanejada): string {
  switch (status) {
    case "PLANEJADA":
    case "PUBLICADA":
      return "Programado";
    case "ACEITA":
      return "Motorista confirmado";
    case "EM_EXECUCAO":
      return "A caminho";
    case "CUMPRIDA":
      return "Entregue";
    case "RECUSADA":
      return "Reprogramando";
    case "FURADA":
      return "Não aconteceu";
    case "CANCELADA":
      return "Cancelado";
  }
}

/**
 * A obra só aprova o que ainda vai acontecer: o que já virou viagem, caiu ou
 * foi cancelado não tem mais o que aprovar.
 */
export function podeAprovarProgramada(p: {
  status: StatusViagemPlanejada;
  viagemId: string | null;
  aprovadaObraEm: Date | null;
}): boolean {
  if (p.aprovadaObraEm || p.viagemId) return false;
  return p.status === "PLANEJADA" || p.status === "PUBLICADA" || p.status === "ACEITA";
}

/** Os status que a obra enxerga na programação. Cancelada some, como no quadro. */
export const STATUS_PROGRAMACAO_VISIVEL: StatusViagemPlanejada[] = [
  "PLANEJADA",
  "PUBLICADA",
  "ACEITA",
  "RECUSADA",
  "EM_EXECUCAO",
  "CUMPRIDA",
];

/** Telefone pra mostrar no painel sem expor inteiro em lista: "(43) •••••-1234". */
export function mascararTelefone(t: string): string {
  const d = t.replace(/\D/g, "");
  return d.length >= 4 ? `(${d.slice(0, 2)}) •••••-${d.slice(-4)}` : "•••";
}
