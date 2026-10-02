import { useMemo } from "react";
import { usePendingChecklists } from "@/hooks/use-pending-checklists";
import { usePermite } from "@/lib/acessos-app";
import { useMeuChecklist } from "@/lib/queries";
import { hojeISO } from "@/lib/datetime";

/** Dia de Brasília de um ISO (UTC-3 fixo, como o hojeISO). */
function diaBR(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Já fez o checklist hoje? Junta o que o servidor sabe com o que está na fila
 * esperando sinal — feito sem internet conta como feito.
 *
 * Com `veiculoId`, vale só o checklist DESSE caminhão (tela de iniciar viagem,
 * onde ele acabou de escolher a placa). Sem ele (null), vale qualquer caminhão:
 * na tela inicial não dá pra saber com qual ele vai sair, e comparar com o
 * "caminhão padrão" do cadastro deixava o lembrete aceso pra sempre em quem
 * não tem padrão ou fez o checklist de outra placa.
 *
 * `devoLembrar` é LEMBRETE, nunca trava: a regra da casa é aceitar e deixar o
 * painel ver quem rodou sem. Só lembra quando a empresa montou um checklist e
 * deixou a função ligada.
 */
export function useChecklistDeHoje(veiculoId: string | null | undefined) {
  const permite = usePermite("app.checklist.fazer");
  const q = useMeuChecklist({ enabled: permite });
  const pendentes = usePendingChecklists();

  return useMemo(() => {
    const hoje = hojeISO();
    const desteCaminhao = (v: string | null | undefined) => !veiculoId || (v ?? null) === veiculoId;
    const feitoNaFila = pendentes.some((p) => desteCaminhao(p.veiculoId) && diaBR(p.feitoEm) === hoje);
    const feitoNoServidor = (q.data?.feitosHoje ?? []).some(
      (f) => desteCaminhao(f.veiculoId) && diaBR(f.feitoEm) === hoje,
    );
    const feito = feitoNaFila || feitoNoServidor;
    const temModelo = Boolean(q.data?.modelo && q.data.modelo.itens.length > 0);
    return { feito, temModelo, devoLembrar: permite && temModelo && !feito };
  }, [pendentes, q.data, veiculoId, permite]);
}
