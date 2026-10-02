"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from "lucide-react";
import type { PortalObraTicket } from "@ronan/shared-types";
import { VisualizadorFotos } from "@/components/visualizador-fotos";
import { baixarFoto, chamar, diaCurto, hojeBR, reais, somarDias, toneladas } from "./api";
import { Aviso, Cartao, Carregando, Vazio } from "./ui";
import { useSessaoCaiu } from "./sessao-caiu";

type Resposta = {
  dia: string;
  total: { viagens: number; toneladas: string };
  viagens: PortalObraTicket[];
};

/**
 * As viagens que chegaram na obra no dia, com a foto do ticket. A foto abre
 * NA PRÓPRIA TELA (visualizador com zoom), nunca em aba nova.
 */
export function AbaTickets({ token, podeVerValores }: { token: string; podeVerValores: boolean }) {
  const [dia, setDia] = React.useState(hojeBR);
  const hoje = hojeBR();
  const q = useQuery({
    queryKey: ["portal-obra", token, "tickets", dia],
    queryFn: () => chamar<Resposta>(`/tickets?dia=${dia}`, { token }),
  });
  useSessaoCaiu(q.error, token);

  // Fotos do dia em sequência no visualizador: a obra confere ticket atrás de
  // ticket, passando pro lado.
  const fotos = React.useMemo(
    () => (q.data?.viagens ?? []).flatMap((v) => v.fotos.map((f) => ({ viagemId: v.id, ...f }))),
    [q.data],
  );
  const [blobs, setBlobs] = React.useState<Record<string, string>>({});
  const [aberta, setAberta] = React.useState<number | null>(null);

  // Baixa as fotos com a sessão no header (a API não aceita a foto sem ela).
  React.useEffect(() => {
    let vivo = true;
    for (const f of fotos) {
      if (blobs[f.id]) continue;
      baixarFoto(token, f.viagemId, f.id)
        .then((url) => vivo && setBlobs((b) => ({ ...b, [f.id]: url })))
        .catch(() => vivo && setBlobs((b) => ({ ...b, [f.id]: "erro" })));
    }
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotos, token]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Dia anterior"
          onClick={() => setDia(somarDias(dia, -1))}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <input
          type="date"
          aria-label="Dia"
          value={dia}
          max={hoje}
          onChange={(e) => e.target.value && setDia(e.target.value)}
          className="block min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-center text-base text-slate-900"
        />
        <button
          type="button"
          aria-label="Próximo dia"
          disabled={dia >= hoje}
          onClick={() => setDia(somarDias(dia, 1))}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white disabled:opacity-40"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {q.isLoading && <Carregando />}
      {q.error && <Aviso>{(q.error as Error).message}</Aviso>}

      {q.data && (
        <Cartao className="grid grid-cols-2 gap-2 text-center">
          <div>
            <p className="text-xs text-slate-500">{dia === hoje ? "Chegaram hoje" : `Chegaram em ${diaCurto(dia)}`}</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{q.data.total.viagens}</p>
            <p className="text-xs text-slate-500">{q.data.total.viagens === 1 ? "viagem" : "viagens"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Peso total</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{toneladas(q.data.total.toneladas)}</p>
            <p className="text-xs text-slate-500">pela balança</p>
          </div>
        </Cartao>
      )}

      {q.data && q.data.viagens.length === 0 && (
        <Vazio titulo="Nenhuma entrega registrada nesse dia">
          As viagens aparecem aqui assim que o motorista registra a entrega com o peso.
        </Vazio>
      )}

      <ul className="space-y-3">
        {q.data?.viagens.map((v) => (
          <li key={v.id}>
            <Cartao className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold tabular-nums text-slate-900">{v.hora ?? "—"}</p>
                  <p className="text-sm text-slate-600">
                    Placa <span className="font-semibold tracking-wide text-slate-900">{v.placa}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums text-slate-900">
                    {v.toneladas != null ? toneladas(v.toneladas) : "—"}
                  </p>
                  <p className="text-sm text-slate-600">{v.material ?? "—"}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                {v.ticket ? `Ticket nº ${v.ticket}` : "Sem número de ticket"}
                {podeVerValores && v.valor != null && (
                  <span className="float-right font-semibold text-slate-900">{reais(v.valor)}</span>
                )}
              </p>
              {v.fotos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {v.fotos.map((f) => {
                    const url = blobs[f.id];
                    const i = fotos.findIndex((x) => x.id === f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        aria-label="Ver foto do ticket"
                        onClick={() => url && url !== "erro" && setAberta(i)}
                        className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                      >
                        {!url ? (
                          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                        ) : url === "erro" ? (
                          <span className="flex flex-col items-center gap-1 text-xs text-slate-400">
                            <ImageOff className="h-5 w-5" /> Foto indisponível
                          </span>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt="Foto do ticket"
                            className="h-full w-full object-contain"
                            style={{ transform: `rotate(${f.rotacao}deg)` }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </Cartao>
          </li>
        ))}
      </ul>

      <VisualizadorFotos
        fotos={fotos
          .filter((f) => blobs[f.id] && blobs[f.id] !== "erro")
          .map((f) => ({ id: f.id, url: blobs[f.id], rotacao: f.rotacao }))}
        indice={
          aberta == null
            ? null
            : fotos.filter((f) => blobs[f.id] && blobs[f.id] !== "erro").findIndex((f) => f.id === fotos[aberta]?.id)
        }
        onIndice={(i) => {
          const visiveis = fotos.filter((f) => blobs[f.id] && blobs[f.id] !== "erro");
          setAberta(fotos.findIndex((f) => f.id === visiveis[i]?.id));
        }}
        onFechar={() => setAberta(null)}
        titulo="Ticket de balança"
      />
    </div>
  );
}
