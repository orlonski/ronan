import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  lembreteLancamentoVisivel,
  textoLembreteLancamento,
  type LembreteLancamentoApp,
} from "@ronan/shared-types";
import { usePendingViagens } from "@/hooks/use-pending-viagens";
import { hojeISO } from "./datetime";
import { useMe, useViagens } from "./queries";
import { storage } from "./storage";

/**
 * Lembrete "você está há N dias sem lançar viagem" na home.
 *
 * A DECISÃO é pura e mora em `@ronan/shared-types` (`lembreteLancamentoVisivel`,
 * testada na API). Aqui só se juntam as entradas do aparelho:
 *  - o lembrete que a API mandou no `/m/me` — cache-first, então offline vale o
 *    último que o aparelho viu;
 *  - as viagens que o aparelho conhece: a lista em cache E o que ainda está na
 *    fila de envio (viagem na fila conta como lançada — some na hora, sem sinal);
 *  - o "Agora não" de hoje, guardado POR CADASTRO (`storage` carimba a empresa) e
 *    por dia de BRASÍLIA (`hojeISO`), nunca o fuso do aparelho.
 *
 * "Não sei" nunca vira cobrança: sem perfil, sem lembrete ou sem poder lançar
 * viagem, não mostra nada.
 */

export const CHAVE_LEMBRETE_DISPENSADO = "ronan.lembrete-lancamento.dispensado";

export function useLembreteLancamento(): {
  visivel: boolean;
  texto: string;
  dispensar: () => void;
} {
  const me = useMe();
  const viagens = useViagens();
  const fila = usePendingViagens();
  const [hoje, setHoje] = useState(hojeISO);
  const [dispensadoEm, setDispensadoEm] = useState<string | null>(null);

  // Ao voltar pra home o dia pode ter virado (app aberto de um dia pro outro).
  useFocusEffect(
    useCallback(() => {
      setHoje(hojeISO());
    }, []),
  );

  useEffect(() => {
    let vivo = true;
    void storage
      .getItem(CHAVE_LEMBRETE_DISPENSADO)
      .then((v) => {
        if (vivo) setDispensadoEm(v);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
    // Recarrega quando o perfil (e portanto o cadastro ativo) muda.
  }, [me.data?.id]);

  const lembrete: LembreteLancamentoApp | null | undefined = me.data?.lembreteLancamento;
  const datasDeViagens = [
    ...(viagens.data ?? []).map((v) => String(v.data).slice(0, 10)),
    // Item na fila sem data legível = lançado agora.
    ...fila.map((p) => {
      const d = (p.payload as { data?: unknown }).data;
      return typeof d === "string" && d.length >= 10 ? d.slice(0, 10) : hoje;
    }),
  ];

  const visivel =
    me.data?.podeLancarViagem === true &&
    lembreteLancamentoVisivel({ lembrete, hoje, dispensadoEm, datasDeViagens });

  const dispensar = useCallback(() => {
    const dia = hojeISO();
    setDispensadoEm(dia);
    void storage.setItem(CHAVE_LEMBRETE_DISPENSADO, dia).catch(() => {});
  }, []);

  return {
    visivel,
    texto: textoLembreteLancamento(lembrete?.dias ?? 1),
    dispensar,
  };
}
