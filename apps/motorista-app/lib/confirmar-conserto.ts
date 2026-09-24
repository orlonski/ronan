import { useSyncExternalStore } from "react";
import { cacheGet, cachePut } from "@/db/database";
import { api, ApiError } from "./api";

/**
 * "FICOU BOM?" — a resposta do motorista ao conserto do aviso dele.
 *
 * Offline-first como tudo no app: a resposta é guardada no aparelho ANTES de
 * tentar enviar, e sobe quando tiver sinal (ao abrir "Meus avisos" de novo).
 * Só sai da fila quando o servidor aceita ou recusa de vez (4xx): o servidor é
 * idempotente — a primeira resposta vale.
 */

type Pendente = { problemaId: string; ficouBom: boolean; comentario?: string | null; em: number };

const KEY = "confirmacoes-conserto";
let _pendentes: Pendente[] = [];
let _carregado = false;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

async function carregar(): Promise<void> {
  if (_carregado) return;
  _pendentes = (await cacheGet<Pendente[]>(KEY).catch(() => null)) ?? [];
  _carregado = true;
  avisar();
}

async function gravar(): Promise<void> {
  await cachePut(KEY, _pendentes).catch(() => {});
  avisar();
}

/** Guarda a resposta e tenta enviar na hora. */
export async function confirmarConserto(problemaId: string, ficouBom: boolean, comentario?: string | null) {
  await carregar();
  _pendentes = [..._pendentes.filter((p) => p.problemaId !== problemaId), { problemaId, ficouBom, comentario, em: Date.now() }];
  await gravar();
  await enviarConfirmacoesPendentes();
}

/** Tenta subir tudo que está guardado. Falha de rede deixa na fila. */
export async function enviarConfirmacoesPendentes(): Promise<void> {
  await carregar();
  for (const p of [..._pendentes]) {
    try {
      await api.post(`/m/problemas-veiculo/${p.problemaId}/confirmar`, {
        ficouBom: p.ficouBom,
        comentario: p.comentario ?? null,
      });
      _pendentes = _pendentes.filter((x) => x.problemaId !== p.problemaId);
    } catch (e) {
      // 4xx de verdade (aviso sumiu, conserto reaberto): não adianta insistir.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        _pendentes = _pendentes.filter((x) => x.problemaId !== p.problemaId);
      }
    }
  }
  await gravar();
}

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  void carregar();
  return () => {
    ouvintes.delete(fn);
  };
}

/** A resposta que ele deu e ainda não subiu, por aviso. */
export function useConfirmacoesPendentes(): Map<string, boolean> {
  const lista = useSyncExternalStore(assinar, () => _pendentes, () => _pendentes);
  return new Map(lista.map((p) => [p.problemaId, p.ficouBom]));
}
