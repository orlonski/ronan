"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { PortalObraProgramada } from "@ronan/shared-types";
import { chamar, diaCurto, hojeBR, somarDias } from "./api";
import { Aviso, Botao, Cartao, Carregando, Selo, Vazio } from "./ui";
import { useSessaoCaiu } from "./sessao-caiu";

type Resposta = { de: string; ate: string; itens: PortalObraProgramada[] };

const TOM_SITUACAO: Record<string, "verde" | "azul" | "cinza" | "ambar" | "vermelho"> = {
  Programado: "azul",
  "Motorista confirmado": "azul",
  "A caminho": "ambar",
  Entregue: "verde",
  Reprogramando: "ambar",
};

/**
 * O que está programado pra obra, semana a semana. "Aprovar" é a obra dizendo
 * "pode vir" — o escritório vê o selo no quadro dele.
 */
export function AbaProgramacao({ token }: { token: string }) {
  const [de, setDe] = React.useState(hojeBR);
  const ate = somarDias(de, 6);
  const qc = useQueryClient();
  const chave = ["portal-obra", token, "programacao", de];
  const q = useQuery({
    queryKey: chave,
    queryFn: () => chamar<Resposta>(`/programacao?de=${de}&ate=${ate}`, { token }),
  });
  useSessaoCaiu(q.error, token);

  const aprovar = useMutation({
    mutationFn: (id: string) => chamar<PortalObraProgramada>(`/programacao/${id}/aprovar`, { method: "POST", token }),
    meta: { erroTratado: true },
    onSuccess: (atualizada) => {
      qc.setQueryData<Resposta>(chave, (r) =>
        r ? { ...r, itens: r.itens.map((i) => (i.id === atualizada.id ? atualizada : i)) } : r,
      );
    },
  });

  const porDia = React.useMemo(() => {
    const m = new Map<string, PortalObraProgramada[]>();
    for (const i of q.data?.itens ?? []) m.set(i.data, [...(m.get(i.data) ?? []), i]);
    return [...m.entries()];
  }, [q.data]);

  const hoje = hojeBR();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Semana anterior"
          disabled={de <= hoje}
          onClick={() => setDe(somarDias(de, -7))}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white disabled:opacity-40"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-center text-sm font-semibold text-slate-800">
          {diaCurto(de)} a {diaCurto(ate)}
        </p>
        <button
          type="button"
          aria-label="Próxima semana"
          onClick={() => setDe(somarDias(de, 7))}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {aprovar.error && <Aviso>{(aprovar.error as Error).message}</Aviso>}
      {q.isLoading && <Carregando />}
      {q.error && <Aviso>{(q.error as Error).message}</Aviso>}
      {q.data && porDia.length === 0 && (
        <Vazio titulo="Nada programado nesses dias">
          Precisa de caminhão? Use a aba Pedir — o escritório confirma e programa.
        </Vazio>
      )}

      {porDia.map(([dia, itens]) => (
        <section key={dia} className="space-y-2">
          <h2 className="text-sm font-bold capitalize text-slate-700">
            {dia === hoje ? "Hoje" : diaCurto(dia)} ·{" "}
            <span className="font-normal normal-case text-slate-500">
              {itens.length === 1 ? "1 viagem" : `${itens.length} viagens`}
            </span>
          </h2>
          {itens.map((i) => (
            <Cartao key={i.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{i.material ?? "Material a combinar"}</p>
                  <p className="text-sm text-slate-600">
                    {[
                      i.janelaInicio ? `${i.janelaInicio}${i.janelaFim ? ` às ${i.janelaFim}` : ""}` : "Horário a combinar",
                      i.placa ? `placa ${i.placa}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Selo tom={TOM_SITUACAO[i.situacao] ?? "cinza"}>{i.situacao}</Selo>
              </div>
              {i.aprovadaEm ? (
                <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                  <Check className="h-4 w-4" /> Você aprovou em{" "}
                  {new Date(i.aprovadaEm).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              ) : i.podeAprovar ? (
                <Botao
                  tom="verde"
                  className="w-full"
                  carregando={aprovar.isPending && aprovar.variables === i.id}
                  onClick={() => aprovar.mutate(i.id)}
                >
                  Aprovar — pode vir
                </Botao>
              ) : null}
            </Cartao>
          ))}
        </section>
      ))}
    </div>
  );
}
