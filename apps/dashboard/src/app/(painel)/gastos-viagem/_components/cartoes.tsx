"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { VisualizadorFotos } from "@/components/visualizador-fotos";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { brl, diaHora, IconeTipo, rotuloStatus, useFotoBlob, type GastoPainel } from "./comum";

/** Gasto de viagem só existe pra quem contratou o módulo e pode ver (Todos ou Conferir). */
function usePodeVerGastos() {
  const { temPermissao, temModulo } = usePermissoes();
  const pode = (c: string) => temPermissao(c) && temModulo(c);
  return { ver: pode("despesas.ver") || pode("conferencia-despesas.ver"), conferir: pode("conferencia-despesas.decidir") };
}

function Miniatura({ g, onAbrir }: { g: GastoPainel; onAbrir: () => void }) {
  const foto = g.fotos[0];
  const blob = useFotoBlob(foto ? `/admin/despesas/${g.id}/fotos/${foto.id}?mini=1` : undefined);
  if (!foto) return <span className="h-10 w-10 shrink-0 rounded bg-muted" aria-hidden />;
  return (
    <button type="button" onClick={onAbrir} title="Ver a foto" className="h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
      {blob.data && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={blob.data} alt="" className="h-full w-full object-cover" style={{ transform: `rotate(${foto.rotacao}deg)` }} />
      )}
    </button>
  );
}

type DaViagem = { itens: GastoPainel[]; total: string; soltos: { id: string; resumo: string }[] };

/**
 * Ficha da viagem › cartão "Gastos desta viagem" (10-telas §10.4): tipo,
 * valor, situação, miniatura (abre na própria tela) e o total. "Vincular gasto
 * sem viagem" oferece os soltos do motorista no dia — nunca liga sozinho.
 */
export function GastosDaViagem({ viagemId }: { viagemId: string }) {
  const { ver, conferir } = usePodeVerGastos();
  const token = useAuthToken();
  const qc = useQueryClient();
  const [foto, setFoto] = React.useState<GastoPainel | null>(null);
  const [solto, setSolto] = React.useState("");
  const q = useQuery({
    queryKey: ["gastos-da-viagem", viagemId],
    enabled: !!token && ver,
    queryFn: () => fetchApi<DaViagem>(`/admin/despesas/viagem/${viagemId}`, { token }),
  });
  if (!ver || !q.data) return null;
  const { itens, total, soltos } = q.data;
  if (itens.length === 0 && soltos.length === 0) return null;

  async function vincular() {
    if (!token || !solto) return;
    try {
      await fetchApi(`/admin/despesas/${solto}/viagem`, { token, method: "PATCH", body: JSON.stringify({ viagemId }) });
      toast.success("Gasto ligado a esta viagem.");
      setSolto("");
      void qc.invalidateQueries({ queryKey: ["gastos-da-viagem", viagemId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      {foto && (
        <VisualizadorFotos
          fotos={foto.fotos.map((f) => ({ id: f.id, caminho: `/admin/despesas/${foto.id}/fotos/${f.id}`, rotacao: f.rotacao }))}
          indice={0}
          onIndice={() => {}}
          onFechar={() => setFoto(null)}
          titulo={foto.tipo.nome}
        />
      )}
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-medium">Gastos desta viagem</h3>
        {itens.length > 0 && <span className="text-sm font-semibold tabular-nums">{brl(total)}</span>}
      </div>
      {itens.length > 0 ? (
        <ul className="divide-y">
          {itens.map((g) => {
            const st = rotuloStatus(g);
            return (
              <li key={g.id} className="flex items-center gap-3 py-2">
                <Miniatura g={g} onAbrir={() => setFoto(g)} />
                <IconeTipo icone={g.tipo.icone} className="h-7 w-7 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{g.tipo.nome}</p>
                  <p className="text-xs text-muted-foreground">{diaHora(g.data)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm tabular-nums">{brl(g.valorInformado)}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.cor)}>{st.texto}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum gasto ligado a esta viagem.</p>
      )}
      {conferir && soltos.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <Select className="w-full sm:w-72" value={solto} onChange={(e) => setSolto(e.target.value)} aria-label="Gasto sem viagem">
            <option value="">Vincular gasto sem viagem…</option>
            {soltos.map((s) => (
              <option key={s.id} value={s.id}>{s.resumo}</option>
            ))}
          </Select>
          <Button variant="default" disabled={!solto} onClick={() => void vincular()}>
            Ligar a esta viagem
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Acerto › "Reembolso de gastos" (10-telas §10.4). As linhas já aparecem em
 * "Ganhos e reembolsos" (tipo REEMBOLSO_DESPESA); aqui vai o total delas e o
 * aviso do que ainda está em conferência — dinheiro faltando nunca vira zero
 * calado.
 */
export function GastosNoAcerto({
  motoristaId,
  periodoInicio,
  periodoFim,
  itens,
  aberto,
}: {
  motoristaId: string;
  periodoInicio: string;
  periodoFim: string;
  itens: { tipo: string; valor: string }[];
  aberto: boolean;
}) {
  const { temModulo } = usePermissoes();
  const { conferir } = usePodeVerGastos();
  const token = useAuthToken();
  const temGastos = temModulo("despesas.ver");
  const de = periodoInicio.slice(0, 10);
  const ate = periodoFim.slice(0, 10);
  const pend = useQuery({
    queryKey: ["gastos-em-conferencia", motoristaId, de, ate],
    enabled: !!token && temGastos && aberto,
    queryFn: () =>
      fetchApi<{ quantidade: number; total: string }>(
        `/admin/despesas/em-conferencia?motoristaId=${motoristaId}&de=${de}&ate=${ate}`,
        { token },
      ),
  });
  if (!temGastos) return null;
  const reembolsos = itens.filter((i) => i.tipo === "REEMBOLSO_DESPESA");
  const soma = reembolsos.reduce((s, i) => s + Number(i.valor), 0);
  const p = pend.data;
  if (reembolsos.length === 0 && !(p && p.quantidade > 0)) return null;
  return (
    <Card className="space-y-2 p-4 text-sm">
      {reembolsos.length > 0 && (
        <p className="flex justify-between gap-2">
          <span className="font-medium">Reembolso de gastos ({reembolsos.length})</span>
          <span className="tabular-nums font-semibold text-emerald-700">{brl(soma)}</span>
        </p>
      )}
      {p && p.quantidade > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-amber-800">
          <TriangleAlert className="h-4 w-4" />
          {p.quantidade} gasto{p.quantidade === 1 ? "" : "s"} ainda em conferência ({brl(p.total)}) não entra
          {p.quantidade === 1 ? "" : "m"} neste acerto.
          {conferir && (
            <Link href="/gastos-viagem/conferir" className="font-medium text-primary hover:underline">
              Conferir agora →
            </Link>
          )}
        </p>
      )}
    </Card>
  );
}
