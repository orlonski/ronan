"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Caminhao = {
  placa: string;
  veiculo: {
    id: string;
    placa: string;
    eixosCavalo: number | null;
    eixosComposicao: number | null;
    eixosSuspensosVazio: number | null;
    eixosConfirmadoEm: string | null;
  } | null;
  sugestao: { eixosComposicao: number | null; eixosSuspensosVazio: number | null; contagem: Record<string, number> } | null;
};

/**
 * Eixos de costume de cada caminhão (03-proposta, decisão e; 04-qa I6). A
 * sugestão vem da MODA das passagens carregadas — nunca do máximo — e só vale
 * depois que alguém confirma. Opcional: sem ele a conferência roda igual.
 */
export function Caminhoes() {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["tag", "caminhoes"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Caminhao[]>("/admin/tag-pedagio/caminhoes", { token: token! }),
  });
  if (q.isLoading) return <LoadingCard />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Quantos eixos o caminhão tem com a carreta de costume, e quantos ele suspende vazio. Com isso, a conferência diz
        quando a cobrança passou do que ele tem — como coisa pra conferir, porque a carreta do dia pode ter sido outra.
      </p>
      {(q.data ?? []).map((c) => (
        <LinhaCaminhao key={c.placa} c={c} />
      ))}
    </div>
  );
}

function LinhaCaminhao({ c }: { c: Caminhao }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const v = c.veiculo;
  const [cavalo, setCavalo] = React.useState(String(v?.eixosCavalo ?? ""));
  const [comp, setComp] = React.useState(String(v?.eixosComposicao ?? c.sugestao?.eixosComposicao ?? ""));
  const [susp, setSusp] = React.useState(String(v?.eixosSuspensosVazio ?? c.sugestao?.eixosSuspensosVazio ?? ""));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function salvar() {
    if (!token || !v) return;
    try {
      await fetchApi(`/admin/tag-pedagio/caminhoes/${v.id}/eixos`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ eixosCavalo: num(cavalo), eixosComposicao: num(comp), eixosSuspensosVazio: num(susp) }),
      });
      toast.success("Eixos guardados.");
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (e) {
      toast.error("Não consegui guardar", { description: e instanceof Error ? e.message : undefined });
    }
  }

  const contagem = Object.entries(c.sugestao?.contagem ?? {})
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([e, n]) => `${e} eixos: ${n}×`)
    .join(" · ");

  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{c.placa}</h3>
        <span className="text-xs text-muted-foreground">
          {v?.eixosConfirmadoEm
            ? `Confirmado em ${new Date(v.eixosConfirmadoEm).toLocaleDateString("pt-BR")}`
            : c.sugestao?.eixosComposicao
              ? `Sugestão pela fatura: ${c.sugestao.eixosComposicao} eixos carregado (a mais frequente), confirme`
              : ""}
        </span>
      </div>
      {contagem && <p className="text-xs text-muted-foreground">Na fatura: {contagem}</p>}
      {!v ? (
        <p className="text-sm text-amber-800">Placa sem caminhão no cadastro — cadastre o caminhão pra guardar os eixos.</p>
      ) : (
        <Permitido chave="tag.decidir">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="block">Eixos do cavalo</span>
              <Input className="w-28" inputMode="numeric" value={cavalo} onChange={(e) => setCavalo(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block">Com a carreta de costume</span>
              <Input className="w-28" inputMode="numeric" value={comp} onChange={(e) => setComp(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block">Suspende vazio</span>
              <Input className="w-28" inputMode="numeric" value={susp} onChange={(e) => setSusp(e.target.value.replace(/\D/g, ""))} />
            </label>
            <Button variant="success" size="sm" onClick={salvar}>
              {v.eixosConfirmadoEm ? "Guardar" : "Confirmar os eixos"}
            </Button>
          </div>
        </Permitido>
      )}
    </Card>
  );
}
