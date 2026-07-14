// Store síncrono pra decisão de força-atualização do app.
// O AuthGate cobre o app inteiro com a tela de bloqueio quando `acao` é
// "bloquear". A decisão vem do backend (GET /m/versao-app), que compara a versão
// deste device com o piso configurado no dashboard.

import type { AcaoAtualizacao, VersaoAppResponse } from "@ronan/shared-types";
import { api } from "./api";

export type VersaoAppEstado = {
  acao: AcaoAtualizacao;
  /** Deep link da loja (market:// / itms-apps://) — só usado quando age. */
  storeUrl: string;
  /** Fallback https da loja. */
  storeUrlWeb: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();

let _estado: VersaoAppEstado = { acao: "nenhuma", storeUrl: "", storeUrlWeb: "" };

export function getVersaoApp(): VersaoAppEstado {
  return _estado;
}

export function subscribeVersaoApp(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function set(e: VersaoAppEstado): void {
  if (
    _estado.acao === e.acao &&
    _estado.storeUrl === e.storeUrl &&
    _estado.storeUrlWeb === e.storeUrlWeb
  ) {
    return;
  }
  _estado = e;
  for (const l of listeners) l();
}

/**
 * Consulta o backend se este device precisa atualizar pela loja. FAIL-OPEN:
 * qualquer erro/timeout/payload estranho = MANTÉM o estado atual (nunca começa
 * a bloquear por falha de rede — caminhoneiro sem sinal segue trabalhando).
 * Chamado ao logar e ao voltar do background. Nunca lança, nunca desloga.
 */
export async function checarVersaoApp(): Promise<void> {
  try {
    const r = await api.get<VersaoAppResponse>("/m/versao-app");
    const acao: AcaoAtualizacao =
      r?.acao === "bloquear" || r?.acao === "recomendar" ? r.acao : "nenhuma";
    set({
      acao,
      storeUrl: typeof r?.storeUrl === "string" ? r.storeUrl : "",
      storeUrlWeb: typeof r?.storeUrlWeb === "string" ? r.storeUrlWeb : "",
    });
  } catch {
    // fail-open: preserva o estado atual (não bloqueia por falha de rede).
  }
}
