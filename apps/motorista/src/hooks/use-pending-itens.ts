import { useEffect, useState } from "react";
import {
  listPendingAbastecimentos,
  listPendingFotos,
  listPendingLocais,
  listPendingPedagios,
  listPendingViagens,
  type PendingAbastecimento,
  type PendingFoto,
  type PendingLocal,
  type PendingPedagio,
  type PendingViagem,
} from "@/db/dexie";
import { onSyncChange } from "@/lib/sync";

/**
 * Hook genérico — escuta o sync e devolve TODAS as listas de pendentes.
 * Atualiza ao notify() do sync e a cada N segundos pra refletir status mudando.
 *
 * Locais e fotos entraram depois (Dexie v4 e v5) e ficaram de fora daqui: eram
 * drenados, podiam estourar as tentativas e virar FALHOU — e não apareciam em
 * lugar nenhum, nem na lista nem no "X com erro". Um local criado offline que o
 * servidor recusa ficava preso pra sempre, invisível. A tela de pendentes tem
 * que listar todos os tipos; tipo faltando aqui é item perdido lá.
 */
export function usePendingItens(): {
  viagens: PendingViagem[];
  pedagios: PendingPedagio[];
  abastecimentos: PendingAbastecimento[];
  locais: PendingLocal[];
  fotos: PendingFoto[];
  loading: boolean;
} {
  const [state, setState] = useState({
    viagens: [] as PendingViagem[],
    pedagios: [] as PendingPedagio[],
    abastecimentos: [] as PendingAbastecimento[],
    locais: [] as PendingLocal[],
    fotos: [] as PendingFoto[],
    loading: true,
  });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [v, p, a, l, f] = await Promise.all([
          listPendingViagens(),
          listPendingPedagios(),
          listPendingAbastecimentos(),
          listPendingLocais(),
          listPendingFotos(),
        ]);
        if (alive)
          setState({
            viagens: v,
            pedagios: p,
            abastecimentos: a,
            locais: l,
            fotos: f,
            loading: false,
          });
      } catch {
        if (alive) setState((s) => ({ ...s, loading: false }));
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}
