import { useCallback } from "react";
import {
  iniciarCapturaPeriodica,
  pararCapturaPeriodica,
  setConfigLocal,
} from "@/lib/posicao-periodica";
import { useSalvarPosicaoConfig, type PosicaoConfig } from "@/lib/queries";

/**
 * Janela que o app sugere a quem liga o compartilhamento pela primeira vez
 * (horário comercial). A tela do Perfil e o convite do "Começar viagem" usam
 * a MESMA — dois padrões diferentes fariam o mesmo toque valer coisas
 * diferentes conforme a porta.
 */
export const JANELA_SUGERIDA = { inicio: 8, fim: 18 } as const;

export const POSICAO_DESLIGADA: PosicaoConfig = {
  ativada: false,
  horarioInicio: null,
  horarioFim: null,
};

export type ResultadoPosicao = "ok" | "permissao-negada";

/**
 * Aplica a config do compartilhamento de posição: salva no servidor, guarda a
 * cópia local (que a task de fundo lê) e liga/desliga a captura.
 *
 * O pedido de permissão do celular acontece AQUI DENTRO, então só pode ser
 * chamado a partir de um toque do motorista — nunca de foco nem de AppState
 * (vira loop de foco: ver feedback_permissao_loop_foco).
 *
 * Se ele negar a permissão, desfaz no servidor e no local pra nenhuma tela
 * dizer "compartilhando" sem estar. Erro de rede sobe pra quem chamou.
 */
export function useAplicarPosicaoConfig() {
  const { mutateAsync, isPending } = useSalvarPosicaoConfig();

  const aplicar = useCallback(
    async (payload: PosicaoConfig): Promise<ResultadoPosicao> => {
      await mutateAsync(payload);
      await setConfigLocal(payload);
      if (!payload.ativada) {
        await pararCapturaPeriodica();
        return "ok";
      }
      const ok = await iniciarCapturaPeriodica();
      if (ok) return "ok";
      await mutateAsync(POSICAO_DESLIGADA);
      await setConfigLocal(POSICAO_DESLIGADA);
      return "permissao-negada";
    },
    [mutateAsync],
  );

  return { aplicar, salvando: isPending };
}
