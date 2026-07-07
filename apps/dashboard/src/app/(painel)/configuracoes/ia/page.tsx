"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ConfigIa = {
  id: string;
  confidenceMinimo: number;
  janelaDias: number;
  modelo: string;
  alteradoEm: string;
};

type ModeloId =
  | "claude-haiku-4-5-20251001"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7";

const MODELOS: {
  id: ModeloId;
  nome: string;
  icone: string;
  custoLabel: string;
  descricao: string;
}[] = [
  {
    id: "claude-haiku-4-5-20251001",
    nome: "Econômico",
    icone: "💰",
    custoLabel: "~R$ 0,01 por match",
    descricao: "Claude Haiku — rápido e baratíssimo. Bom pra maioria dos fechamentos.",
  },
  {
    id: "claude-sonnet-4-6",
    nome: "Equilibrado",
    icone: "⭐",
    custoLabel: "~R$ 0,05 por match",
    descricao: "Claude Sonnet — 5x mais caro, mas decide melhor casos ambíguos (formato confuso, dados parciais).",
  },
  {
    id: "claude-opus-4-7",
    nome: "Premium",
    icone: "🚀",
    custoLabel: "~R$ 0,30 por match",
    descricao: "Claude Opus — top de linha. Vale só pra fechamentos complexos onde o custo da revisão manual é maior que o custo da chamada.",
  },
];

const PATH = "/admin/ia-config";
const HISTORICO_PATH = "/admin/ia-config/historico-sugestoes";

const PRESETS = [
  {
    nome: "Conservador",
    icone: "🛡️",
    confidence: 0.95,
    dias: 3,
    descricao:
      "A IA só fecha quando tá quase 100% certa. Você revisa mais, mas tem mais controle.",
  },
  {
    nome: "Equilibrado",
    icone: "⚖️",
    confidence: 0.85,
    dias: 3,
    descricao: "Configuração padrão. Bom pra maioria dos casos.",
  },
  {
    nome: "Agressivo",
    icone: "⚡",
    confidence: 0.75,
    dias: 7,
    descricao:
      "A IA fecha mais coisa. Bom se você confia muito nela e quer trabalhar menos.",
  },
] as const;

function frasePraConfidence(c: number): string {
  if (c <= 0.7) return "Bem permissivo. A IA fecha mesmo casos duvidosos. Risco de match errado mais alto.";
  if (c <= 0.85) return "Equilibrado. A IA fecha casos óbvios e quase-óbvios.";
  if (c <= 0.95) return "Conservador. A IA só fecha casos quase certos.";
  return "Bem rigoroso. Quase tudo cai pra revisão manual.";
}

function frasePraJanela(d: number): string {
  if (d <= 2) return "Bem restrito. Só pega casos onde data bate quase exato.";
  if (d <= 7) return "Equilibrado. Pega motorista que esqueceu de lançar e lançou tarde.";
  return "Bem aberto. Pega lançamentos atrasados extremos. Pode confundir viagens parecidas.";
}

export default function IaConfigPage() {
  const token = useAuthToken();
  const qc = useQueryClient();

  const cfg = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigIa>(PATH, { token }),
  });

  const historico = useQuery({
    queryKey: [HISTORICO_PATH],
    enabled: !!token,
    queryFn: () => fetchApi<{ confidence: number }[]>(HISTORICO_PATH, { token }),
  });

  const [confidence, setConfidence] = useState(0.85);
  const [dias, setDias] = useState(3);
  const [modelo, setModelo] = useState<ModeloId>("claude-haiku-4-5-20251001");

  useEffect(() => {
    if (cfg.data) {
      setConfidence(cfg.data.confidenceMinimo);
      setDias(cfg.data.janelaDias);
      setModelo(cfg.data.modelo as ModeloId);
    }
  }, [cfg.data]);

  const update = useMutation({
    mutationFn: (body: {
      confidenceMinimo: number;
      janelaDias: number;
      modelo: ModeloId;
    }) =>
      fetchApi<ConfigIa>(PATH, {
        method: "PUT",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
  });

  const histograma = useMemo(() => {
    const bins = Array.from({ length: 10 }, () => 0);
    for (const s of historico.data ?? []) {
      const idx = Math.min(9, Math.max(0, Math.floor(s.confidence * 10)));
      bins[idx]!++;
    }
    return bins;
  }, [historico.data]);

  const totalSugestoes = historico.data?.length ?? 0;
  const fechariam = (historico.data ?? []).filter((s) => s.confidence >= confidence).length;
  const reveriam = totalSugestoes - fechariam;
  if (cfg.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function aplicarPreset(p: (typeof PRESETS)[number]) {
    setConfidence(p.confidence);
    setDias(p.dias);
  }

  function presetAtivo(p: (typeof PRESETS)[number]): boolean {
    return Math.abs(p.confidence - confidence) < 0.001 && p.dias === dias;
  }

  async function salvar() {
    await update.mutateAsync({
      confidenceMinimo: confidence,
      janelaDias: dias,
      modelo,
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-6 w-6 text-amber-600" />
          Inteligência Artificial
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Quando o motorista lança uma viagem, a IA tenta combinar com a
          planilha do cliente. Aqui você ajusta o quanto a IA pode decidir
          sozinha vs quanto vem pra você revisar. Se a IA errar, a viagem entra
          como divergência — você sempre pode corrigir.
        </p>
      </header>

      {/* Modelo */}
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Qual modelo de IA usar?
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            O custo é por chamada — mais rápido = mais barato. Comece pelo Econômico; se notar erros frequentes em casos difíceis, sobe pra Equilibrado.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {MODELOS.map((m) => {
            const ativo = modelo === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setModelo(m.id)}
                className={`rounded-lg border-2 p-4 text-left transition-colors ${
                  ativo
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="mb-1 text-2xl">{m.icone}</div>
                <div className="font-bold">{m.nome}</div>
                <div className="text-xs text-muted-foreground">{m.custoLabel}</div>
                <p className="mt-2 text-xs text-muted-foreground">{m.descricao}</p>
                {ativo && (
                  <div className="mt-2 text-xs font-medium text-primary">
                    ✓ atual
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Presets */}
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Como você quer que a IA trabalhe?
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {PRESETS.map((p) => {
            const ativo = presetAtivo(p);
            return (
              <button
                key={p.nome}
                type="button"
                onClick={() => aplicarPreset(p)}
                className={`rounded-lg border-2 p-4 text-left transition-colors ${
                  ativo
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="mb-1 text-2xl">{p.icone}</div>
                <div className="font-bold">{p.nome}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(p.confidence * 100)}% certeza · ±{p.dias} dia(s)
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {p.descricao}
                </p>
                {ativo && (
                  <div className="mt-2 text-xs font-medium text-primary">
                    ✓ atual
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Slider 1: confidence */}
      <Card className="space-y-3 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Quão certa a IA precisa estar pra fechar sozinha?
          </h2>
          <span className="text-2xl font-bold text-primary">
            {Math.round(confidence * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={50}
          max={99}
          step={5}
          value={Math.round(confidence * 100)}
          onChange={(e) => setConfidence(Number(e.target.value) / 100)}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>50% (permissivo)</span>
          <span>99% (rigoroso)</span>
        </div>
        <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          {frasePraConfidence(confidence)}
        </p>
      </Card>

      {/* Slider 2: janela */}
      <Card className="space-y-3 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Procurar viagens em quantos dias antes/depois?
          </h2>
          <span className="text-2xl font-bold text-primary">
            ±{dias} dia{dias === 1 ? "" : "s"}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={14}
          step={1}
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1 dia (restrito)</span>
          <span>14 dias (aberto)</span>
        </div>
        <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          {frasePraJanela(dias)}
        </p>
      </Card>

      {/* Simulador / histograma */}
      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Como ficaria com as últimas {totalSugestoes} sugestões da IA
        </h2>

        {totalSugestoes === 0 ? (
          <p className="text-sm text-muted-foreground">
            Quando os primeiros fechamentos rodarem, mostro aqui como sua
            escolha afetaria os resultados.
          </p>
        ) : (
          <>
            {/* Histograma */}
            <div>
              <div className="flex h-32 items-end gap-1">
                {histograma.map((count, i) => {
                  const max = Math.max(...histograma, 1);
                  const altura = Math.max(2, (count / max) * 100);
                  const faixaInicio = i / 10;
                  const ehAcimaThreshold = faixaInicio >= confidence;
                  return (
                    <div
                      key={i}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {count > 0 ? count : ""}
                      </span>
                      <div
                        className={`w-full rounded-t transition-colors ${
                          ehAcimaThreshold ? "bg-green-500" : "bg-amber-400"
                        }`}
                        style={{ height: `${altura}%` }}
                        title={`${faixaInicio * 100}–${(faixaInicio + 0.1) * 100}%: ${count} sugestões`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex">
                {histograma.map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 text-center text-[10px] text-muted-foreground"
                  >
                    {i * 10}
                  </div>
                ))}
              </div>
              <div className="text-center text-[10px] text-muted-foreground">
                certeza da IA (%)
              </div>
            </div>

            {/* Resultado */}
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div className="rounded-md border bg-green-50 p-3">
                <div className="text-xs uppercase tracking-wider text-green-900">
                  ✅ fechadas automaticamente
                </div>
                <div className="text-2xl font-bold text-green-700">
                  {fechariam}
                </div>
                <div className="text-xs text-muted-foreground">
                  de {totalSugestoes} sugestões
                </div>
              </div>
              <div className="rounded-md border bg-amber-50 p-3">
                <div className="text-xs uppercase tracking-wider text-amber-900">
                  ⚠️ precisariam de revisão
                </div>
                <div className="text-2xl font-bold text-amber-700">
                  {reveriam}
                </div>
                <div className="text-xs text-muted-foreground">
                  de {totalSugestoes} sugestões
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Salvar */}
      <div className="flex justify-end gap-2">
        <Button onClick={salvar} disabled={update.isPending}>
          <Save className="h-4 w-4" />
          {update.isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>

      {update.isSuccess && (
        <p className="text-right text-sm text-green-700">
          ✓ Salvo. Vale pros próximos fechamentos processados.
        </p>
      )}
      {update.isError && (
        <p className="text-right text-sm text-destructive">
          {(update.error as Error).message}
        </p>
      )}
    </div>
  );
}
