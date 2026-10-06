"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { brl, dia, type Casamento, type Extrato, type TrechoTela } from "./tipos";

/**
 * "Casar passagens com viagens": um caminhão, um dia. À esquerda o trecho da
 * tag, no meio a situação, à direita a viagem — com o motivo da sugestão.
 * Ligar à mão é escolher a viagem; desfazer é um clique. Nada de formulário.
 */

const SITUACAO: Record<string, { rotulo: string; classe: string }> = {
  LIGADA_SOZINHA: { rotulo: "Ligada sozinha", classe: "bg-green-100 text-green-800" },
  LIGADA: { rotulo: "Ligada", classe: "bg-green-100 text-green-800" },
  LIGARIA_SOZINHA: { rotulo: "O sistema ligaria sozinho", classe: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300" },
  SUGESTAO: { rotulo: "Sugestão", classe: "bg-amber-100 text-amber-900" },
  SEM_VIAGEM: { rotulo: "Sem viagem lançada", classe: "bg-red-100 text-red-800" },
  RETORNO: { rotulo: "Retorno vazio", classe: "bg-slate-200 text-slate-700" },
  IDA_VAZIA: { rotulo: "Ida vazia", classe: "bg-slate-200 text-slate-700" },
  RETORNO_CONFIRMADO: { rotulo: "Retorno (confirmado)", classe: "bg-slate-200 text-slate-800" },
  VAZIO_SOLTO: { rotulo: "Vazio solto", classe: "bg-slate-100 text-slate-600" },
  NAO_E_VIAGEM: { rotulo: "Não é viagem", classe: "bg-slate-100 text-slate-600" },
};

export function CasarPassagens({
  extratoId,
  placa,
  dia: diaEscolhido,
  onIr,
}: {
  extratoId: string | null;
  placa: string | null;
  dia: string | null;
  onIr: (m: Record<string, string | null>) => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const extratos = useQuery({
    queryKey: ["tag-extratos"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Extrato[]>("/admin/tag-pedagio/extratos", { token: token! }),
  });
  const placas = React.useMemo(() => {
    const lista = (extratos.data ?? []).filter((e) => e.status !== "FALHOU" && (!extratoId || e.id === extratoId));
    return [...new Set(lista.flatMap((e) => e.placas.map((p) => p.placa)))].sort();
  }, [extratos.data, extratoId]);
  const placaAtual = placa && placas.includes(placa) ? placa : placas[0] ?? null;

  const q = useQuery({
    queryKey: ["tag", "casamento", placaAtual, diaEscolhido],
    enabled: Boolean(token && placaAtual),
    queryFn: () =>
      fetchApi<Casamento>(
        `/admin/tag-pedagio/casamento?placa=${placaAtual}${diaEscolhido ? `&dia=${diaEscolhido}` : ""}`,
        { token: token! },
      ),
    placeholderData: (p) => p,
  });
  const c = q.data;
  const idx = c?.dias.findIndex((d) => d.dia === c.dia) ?? -1;
  const pendentes = (c?.trechos ?? []).filter((t) => !t.decidida && ["SUGESTAO", "LIGARIA_SOZINHA", "RETORNO", "IDA_VAZIA"].includes(t.situacao) && t.viagem && !/^comboio|empate/.test(t.motivo));

  async function aceitarTodas() {
    if (!token || !pendentes.length) return;
    try {
      const r = await fetchApi<{ aceitas: number }>("/admin/tag-pedagio/ligacoes/aceitar", {
        token,
        method: "POST",
        body: JSON.stringify({ passagemAncoraIds: pendentes.map((t) => t.passagemAncoraId) }),
      });
      toast.success(`${r.aceitas} sugestão(ões) aceita(s).`);
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (e) {
      toast.error("Não consegui aceitar", { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function recalcular() {
    if (!token) return;
    try {
      await fetchApi("/admin/tag-pedagio/recalcular", { token, method: "POST" });
      toast.success("Conferência recalculada com as viagens lançadas até agora.");
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (e) {
      toast.error("Não consegui recalcular", { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (extratos.isLoading) return <LoadingCard />;
  if (!placas.length) return <Card className="p-8 text-center text-sm text-muted-foreground">Suba uma fatura pra casar as passagens.</Card>;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Caminhão" className="w-40" value={placaAtual ?? ""} onChange={(e) => onIr({ placa: e.target.value, dia: null })}>
          {placas.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        {c && c.dias.length > 0 && (
          <>
            <Button variant="outline" size="sm" disabled={idx <= 0} onClick={() => onIr({ dia: c.dias[idx - 1]!.dia })} aria-label="Dia anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select aria-label="Dia" className="w-72" value={c.dia ?? ""} onChange={(e) => onIr({ dia: e.target.value })}>
              {c.dias.map((d) => (
                <option key={d.dia} value={d.dia}>
                  {dia(d.dia)} · {d.trechos} trecho(s){d.pendentes ? ` · ${d.pendentes} pra ver` : ""}
                </option>
              ))}
            </Select>
            <Button variant="outline" size="sm" disabled={idx < 0 || idx >= c.dias.length - 1} onClick={() => onIr({ dia: c.dias[idx + 1]!.dia })} aria-label="Próximo dia">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Permitido chave="tag.decidir">
            <Button variant="outline" size="sm" onClick={recalcular}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Recalcular
            </Button>
            {pendentes.length > 0 && (
              <Button variant="success" size="sm" onClick={aceitarTodas}>
                Aceitar as {pendentes.length} sugestões do dia
              </Button>
            )}
          </Permitido>
        </div>
      </div>

      {q.isLoading && <LoadingCard />}
      {c && (
        <>
          <div className="hidden grid-cols-[minmax(0,1.1fr)_170px_minmax(0,1.2fr)] gap-3 px-3 text-xs font-extrabold tracking-wider text-muted-foreground md:grid">
            <span>PASSAGENS DA TAG (TRECHO)</span>
            <span>SITUAÇÃO</span>
            <span>VIAGEM</span>
          </div>
          <div className="space-y-2">
            {c.trechos.map((t) => (
              <LinhaTrecho key={t.passagemAncoraId} t={t} viagensDoDia={c.viagensDoDia} />
            ))}
            {c.pracasSemCobranca.map((p) => (
              <div key={`${p.viagemId}-${p.chave}`} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1.1fr)_170px_minmax(0,1.2fr)]">
                <div>
                  <b>Viagem sem passagem</b>
                  <p className="text-sm text-muted-foreground">A rota prevê {p.praca}</p>
                </div>
                <span className="h-fit w-fit rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Praça sem cobrança</span>
                <p className="text-sm text-muted-foreground">
                  Pode ter pago em dinheiro, a tag não leu ou a rota foi outra. Se o motorista pagou do bolso, é esta praça
                  que ele lança.
                </p>
              </div>
            ))}
          </div>
          <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
            O sistema só sugere: no primeiro mês nada liga sozinho, e o que ele ligaria aparece marcado. Toda ligação pode
            ser desfeita, e a praça corrigida uma vez não precisa ser corrigida de novo.
          </p>
        </>
      )}
    </Card>
  );
}

function LinhaTrecho({ t, viagensDoDia }: { t: TrechoTela; viagensDoDia: Casamento["viagensDoDia"] }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [escolhendo, setEscolhendo] = React.useState(false);
  const [outra, setOutra] = React.useState("");
  const s = SITUACAO[t.situacao] ?? { rotulo: t.situacao, classe: "bg-muted" };
  // A hora é a da praça (MT −4, TO −3), como a fatura imprime: vem pronta da API.
  const ini = t.passagens[0]?.hora.slice(0, 5) ?? "";
  const fim = t.passagens.at(-1)?.hora.slice(0, 5) ?? "";
  const eixos = Math.max(...t.passagens.map((p) => p.eixos));
  const pendente = !t.decidida && ["SUGESTAO", "LIGARIA_SOZINHA", "RETORNO", "IDA_VAZIA", "SEM_VIAGEM"].includes(t.situacao);

  async function decidir(acao: string, viagemId?: string) {
    if (!token) return;
    try {
      await fetchApi("/admin/tag-pedagio/ligacoes", {
        token,
        method: "POST",
        body: JSON.stringify({ passagemAncoraId: t.passagemAncoraId, acao, viagemId }),
      });
      setEscolhendo(false);
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (e) {
      toast.error("Não consegui guardar", { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <div
      className={cn(
        "grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1.1fr)_170px_minmax(0,1.2fr)]",
        pendente && t.estado === "CARREGADO" && "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20",
        t.situacao === "LIGARIA_SOZINHA" && "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20",
        ["LIGADA", "LIGADA_SOZINHA"].includes(t.situacao) && "border-green-300",
      )}
    >
      <div className="min-w-0">
        <b>
          {ini}
          {fim !== ini && ` → ${fim}`} · {t.estado === "CARREGADO" ? `carregado · ${eixos} eixos` : "vazio"}
        </b>
        <p className="text-sm text-muted-foreground">
          {t.passagens.map((p) => `${p.cidade} ${p.sentido[0]}${p.tipo === "VALE" ? " (vale)" : ""}`).join(" · ")} ·{" "}
          {brl(t.valorTag)}
          {t.valorVale > 0 && ` + ${brl(t.valorVale)} de vale`}
        </p>
      </div>
      <span className={cn("h-fit w-fit rounded-full px-2 py-0.5 text-xs font-bold", s.classe)}>{s.rotulo}</span>
      <div className="min-w-0 space-y-1 text-sm">
        {t.viagem ? (
          <>
            <b>{t.viagem.rotulo}</b>
            <p className="text-muted-foreground">
              {t.viagem.data && `lançada ${dia(t.viagem.data)}`}
              {t.razao && ` · ${t.razao}`}
              {t.motivo && !t.decidida && t.situacao !== "LIGARIA_SOZINHA" && ` · ${t.motivo}`}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{t.motivo || "—"}</p>
        )}
        <Permitido chave="tag.decidir">
          {t.decidida ? (
            <Button size="sm" variant="outline" onClick={() => decidir("DESFAZER")}>
              Desfazer
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              {t.viagem && t.estado === "CARREGADO" && (
                <Button size="sm" variant="success" onClick={() => decidir("ACEITAR")}>
                  {t.motivo.startsWith("comboio") ? "É desta viagem" : "Aceitar"}
                </Button>
              )}
              {t.viagem && t.estado === "VAZIO" && (
                <Button size="sm" variant="success" onClick={() => decidir("ACEITAR")}>
                  É o retorno desta viagem
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setEscolhendo((v) => !v)}>
                Outra viagem
              </Button>
              {t.estado === "CARREGADO" && (
                <Button size="sm" variant="outline" onClick={() => decidir("NAO_E_VIAGEM")}>
                  Não é viagem
                </Button>
              )}
            </div>
          )}
          {escolhendo && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2">
              <Select aria-label="Viagem" className="w-72" value={outra} onChange={(e) => setOutra(e.target.value)}>
                <option value="">Escolha a viagem…</option>
                {[...t.candidatas.map((x) => x.viagem).filter((v): v is NonNullable<typeof v> => !!v), ...viagensDoDia]
                  .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.data ? `${dia(v.data)} · ` : ""}
                      {v.rotulo} · {v.placa}
                    </option>
                  ))}
              </Select>
              <Button size="sm" variant="outline" onClick={() => setEscolhendo(false)}>
                Voltar
              </Button>
              <Button size="sm" variant="success" disabled={!outra} onClick={() => decidir(t.estado === "VAZIO" ? "RETORNO" : "OUTRA_VIAGEM", outra)}>
                {t.estado === "VAZIO" ? "É o retorno desta" : "Ligar a esta viagem"}
              </Button>
            </div>
          )}
        </Permitido>
      </div>
    </div>
  );
}
