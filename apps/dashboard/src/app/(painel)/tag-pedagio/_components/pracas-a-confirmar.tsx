"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { brl, type PracaFila } from "./tipos";

const MapaPraca = dynamic(() => import("./mapa-praca").then((m) => m.MapaPraca), {
  ssr: false,
  loading: () => <div className="h-[260px] animate-pulse rounded-md bg-muted" />,
});

/**
 * A fila "praças a confirmar": a praça do extrato que não casou sozinha com o
 * mapa. A prova é o TEMPO: o intervalo entre passagens seguidas comparado com
 * o tempo de rota até cada candidata. Confirmar vale pra esta empresa; pra
 * todas, só a equipe da Movatruck (04-qa M6).
 */
export function PracasAConfirmar() {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["tag", "pracas"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<PracaFila[]>("/admin/tag-pedagio/pracas/fila", { token: token! }),
  });
  if (q.isLoading) return <LoadingCard />;
  if (q.error) return <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(q.error as Error).message}</Card>;
  if (!q.data?.length)
    return (
      <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
        Todas as praças das faturas já estão ligadas ao mapa.
      </Card>
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {q.data.length} praça(s) da fatura não casaram sozinhas com o mapa. Sem a praça, as passagens dela não ajudam a achar
        a viagem — confirme uma vez e vale pra sempre.
      </p>
      {q.data.map((p) => (
        <CartaoPraca key={p.chavePraca} p={p} />
      ))}
    </div>
  );
}

function CartaoPraca({ p }: { p: PracaFila }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { plataforma } = usePermissoes();
  const [salvando, setSalvando] = React.useState(false);

  async function confirmar(pedagioRodoviaId: string, global: boolean) {
    if (!token) return;
    setSalvando(true);
    try {
      await fetchApi("/admin/tag-pedagio/pracas/confirmar", {
        token,
        method: "POST",
        body: JSON.stringify({ operadora: p.operadora, chavePraca: p.chavePraca, pedagioRodoviaId, global }),
      });
      toast.success(global ? "Praça confirmada pra todas as empresas." : "Praça confirmada.");
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (e) {
      toast.error("Não consegui confirmar", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-2">
        <div>
          <h3 className="font-semibold">
            {p.rodovia} km {p.km.toLocaleString("pt-BR")} · {p.cidade}
          </h3>
          <p className="text-xs text-muted-foreground">
            {p.concessionaria ?? "concessionária ?"} · {p.passagens} passagem(ns) na fatura
            {p.tarifaEixo != null && ` · ${brl(p.tarifaEixo)} por eixo`}
          </p>
          <p className="text-sm text-amber-800">{p.motivo}</p>
        </div>
        {p.candidatos.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma praça do mapa a até 80 km da cidade.</p>}
        <ol className="space-y-2">
          {p.candidatos.map((c, i) => (
            <li key={c.pedagioRodoviaId} className="rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{i + 1}.</b> {c.nome}
                  <span className="text-muted-foreground">
                    {" "}
                    · {c.rodovias.join(", ") || "sem rodovia no mapa"} · {c.distanciaKm} km da cidade
                  </span>
                </span>
                <Permitido chave="tag.decidir">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="success" disabled={salvando} onClick={() => confirmar(c.pedagioRodoviaId, false)}>
                      É esta
                    </Button>
                    {plataforma && (
                      <Button size="sm" variant="outline" disabled={salvando} onClick={() => confirmar(c.pedagioRodoviaId, true)}>
                        É esta, pra todas as empresas
                      </Button>
                    )}
                  </div>
                </Permitido>
              </div>
              {c.tempos.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {c.tempos.map((t, k) => {
                    const bate = t.rotaMin != null && t.observadoMin >= t.rotaMin * 0.85 && t.observadoMin <= t.rotaMin * 1.25 + 10;
                    return (
                      <li key={k} className={cn(bate ? "text-green-800" : "text-muted-foreground")}>
                        de/até {t.vizinha}: passou em {t.observadoMin} min · a rota até esta praça leva{" "}
                        {t.rotaMin == null ? "?" : `${t.rotaMin} min`}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
      <MapaPraca
        sede={p.sede}
        cidade={p.cidade}
        candidatos={p.candidatos.map((c) => ({ id: c.pedagioRodoviaId, nome: c.nome, lat: c.lat, lng: c.lng }))}
      />
    </Card>
  );
}
