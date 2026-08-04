import { useEffect, useState } from "react";
import {
  listPendingFotos,
  listPendingLocais,
  listPendingStories,
  type PendingFoto,
  type PendingLocal,
  type PendingStory,
} from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Os tipos do outbox que a tela de Pendentes não mostrava: foto avulsa (anexada
 * a viagem já sincronizada), local criado offline e story.
 *
 * Eles existiam na fila mas não apareciam em lugar nenhum — um item desses
 * travado ficava invisível pro motorista E pro escritório, sem jeito de tentar
 * de novo nem de descartar. Foi o que segurou a fila de um motorista de iPhone:
 * a foto tinha sumido do cache do aparelho, o envio falhava toda passada, e
 * ninguém tinha como ver isso.
 */
export function usePendingOutros(): {
  fotos: PendingFoto[];
  locais: PendingLocal[];
  stories: PendingStory[];
} {
  const [fotos, setFotos] = useState<PendingFoto[]>([]);
  const [locais, setLocais] = useState<PendingLocal[]>([]);
  const [stories, setStories] = useState<PendingStory[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [f, l, s] = await Promise.all([
          listPendingFotos(),
          listPendingLocais(),
          listPendingStories(),
        ]);
        if (!alive) return;
        setFotos(f);
        setLocais(l);
        setStories(s);
      } catch {
        /* db indisponível */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return { fotos, locais, stories };
}
