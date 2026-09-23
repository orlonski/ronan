"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ModeloIaConferencia, ModeloIaMatch } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ConfigIa = {
  confidenceMinimo: number;
  janelaDias: number;
  modelo: string;
  modeloConferencia: string | null;
  /** `confidence` das últimas sugestões da IA no fechamento desta empresa. */
  historicoSugestoes: number[];
};

type Opcao<T> = { id: T; nome: string; custoLabel: string; descricao: string };

/**
 * Quem lê a foto do ticket. É o único modelo que pesa de verdade hoje, por
 * isso vem primeiro.
 *
 * `null` = usa o que estiver configurado no servidor (CONFERENCIA_MODELO).
 */
const MODELOS_CONFERENCIA: Opcao<ModeloIaConferencia | null>[] = [
  {
    id: null,
    nome: "Padrão do sistema",
    custoLabel: "o que o servidor definir",
    descricao: "Deixa como está. É o que roda hoje em todas as empresas.",
  },
  {
    id: "claude-haiku-4-5-20251001",
    nome: "Claude Haiku",
    custoLabel: "US$ 1,00 / 5,00 por milhão de tokens",
    descricao:
      "O que lê os tickets hoje. Rápido, barato e já conhecido — é contra ele que os outros se comparam.",
  },
  {
    id: "MiniMax-M3",
    nome: "MiniMax M3",
    custoLabel: "US$ 0,30 / 1,20 por milhão de tokens",
    descricao:
      "Em avaliação. Cerca de 3x mais barato que o Haiku, mas é outro fornecedor (a foto do ticket sai daqui). A segunda opinião continua no Claude, então erro dele não vira acusação.",
  },
  {
    id: "claude-sonnet-4-6",
    nome: "Claude Sonnet",
    custoLabel: "US$ 3,00 / 15,00 por milhão de tokens",
    descricao: "Lê melhor foto ruim, e custa 3x o Haiku em toda leitura.",
  },
];

/** Quem casa a viagem com a planilha do cliente, no fechamento. */
const MODELOS_MATCH: Opcao<ModeloIaMatch>[] = [
  {
    id: "claude-haiku-4-5-20251001",
    nome: "Econômico",
    custoLabel: "~R$ 0,01 por match",
    descricao: "Claude Haiku — rápido e baratíssimo. Bom pra maioria dos fechamentos.",
  },
  {
    id: "claude-sonnet-4-6",
    nome: "Equilibrado",
    custoLabel: "~R$ 0,05 por match",
    descricao: "Claude Sonnet — 5x mais caro, decide melhor planilha confusa ou com dado parcial.",
  },
  {
    id: "claude-opus-4-7",
    nome: "Premium",
    custoLabel: "~R$ 0,30 por match",
    descricao: "Claude Opus — só vale onde revisar na mão custa mais que a chamada.",
  },
];

function frasePraConfidence(c: number): string {
  if (c <= 0.7) return "Bem permissivo. A IA fecha mesmo casos duvidosos. Risco de match errado mais alto.";
  if (c <= 0.85) return "Equilibrado. A IA fecha casos óbvios e quase-óbvios.";
  if (c <= 0.95) return "Conservador. A IA só fecha casos quase certos.";
  return "Bem rigoroso. Quase tudo cai pra revisão manual.";
}

function frasePraJanela(d: number): string {
  if (d <= 2) return "Bem restrito. Só pega casos onde a data bate quase exato.";
  if (d <= 7) return "Equilibrado. Pega motorista que esqueceu de lançar e lançou tarde.";
  return "Bem aberto. Pega lançamentos muito atrasados, e pode confundir viagens parecidas.";
}

/**
 * Os modelos de IA de uma empresa.
 *
 * Era uma tela em Ajustes que só a plataforma via. Mora aqui porque a chave de
 * API e a fatura são nossas: qual modelo cada cliente usa — e quanto isso
 * custa — é decisão da plataforma, do mesmo jeito que ligar a IA dele.
 */
export function IaConfigDialog({
  conta,
  aberto,
  onFechar,
}: {
  conta: { id: string; nome: string } | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const path = conta ? `/admin/contas/${conta.id}/ia-config` : "";

  const { data, isLoading } = useQuery({
    queryKey: ["ia-config", conta?.id],
    enabled: Boolean(token && conta && aberto),
    queryFn: () => fetchApi<ConfigIa>(path, { token: token! }),
  });

  const [confidence, setConfidence] = useState(0.85);
  const [dias, setDias] = useState(3);
  const [modelo, setModelo] = useState<ModeloIaMatch>("claude-haiku-4-5-20251001");
  const [modeloConferencia, setModeloConferencia] = useState<ModeloIaConferencia | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!data) return;
    setConfidence(data.confidenceMinimo);
    setDias(data.janelaDias);
    setModelo(data.modelo as ModeloIaMatch);
    setModeloConferencia((data.modeloConferencia as ModeloIaConferencia | null) ?? null);
  }, [data]);

  const historico = data?.historicoSugestoes ?? [];
  const histograma = useMemo(() => {
    const bins = Array.from({ length: 10 }, () => 0);
    for (const c of historico) bins[Math.min(9, Math.max(0, Math.floor(c * 10)))]!++;
    return bins;
  }, [historico]);
  const fechariam = historico.filter((c) => c >= confidence).length;

  async function salvar() {
    if (!token || !conta) return;
    setSalvando(true);
    try {
      await fetchApi(path, {
        token,
        method: "PUT",
        body: JSON.stringify({ confidenceMinimo: confidence, janelaDias: dias, modelo, modeloConferencia }),
      });
      await qc.invalidateQueries({ queryKey: ["ia-config", conta.id] });
      toast.success(`Modelos de IA de ${conta.nome} salvos. Valem nas próximas leituras.`);
      onFechar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modelos de IA de {conta?.nome}</DialogTitle>
          <DialogDescription>
            Qual modelo lê o ticket e casa a viagem com a planilha do cliente desta empresa. As
            chaves de API ficam no servidor. Ligar e desligar a IA continua nos botões do card.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {data && (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Quem lê a foto do ticket?</h3>
              <p className="text-xs text-muted-foreground">
                É a leitura da Conferência de ticket, que roda sozinha depois que o motorista lança.
                Quando a leitura sai fraca ou aponta divergência de peso, o Claude Opus dá a segunda
                opinião — isso não muda aqui. O custo real de cada leitura aparece na tela de{" "}
                <a href="/conferencias" className="underline underline-offset-2">
                  Conferência de ticket
                </a>
                .
              </p>
              <Opcoes opcoes={MODELOS_CONFERENCIA} valor={modeloConferencia} onEscolher={setModeloConferencia} />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Quem casa a viagem com a planilha do cliente?</h3>
              <p className="text-xs text-muted-foreground">
                Roda no fechamento, quando a planilha do tomador é conciliada com o que foi lançado.
              </p>
              <Opcoes opcoes={MODELOS_MATCH} valor={modelo} onEscolher={setModelo} />
            </section>

            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Certeza mínima pra fechar sozinha</h3>
                <span className="text-lg font-bold text-primary">{Math.round(confidence * 100)}%</span>
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
              <p className="text-xs text-muted-foreground">{frasePraConfidence(confidence)}</p>
            </section>

            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Procurar a viagem em quantos dias antes/depois</h3>
                <span className="text-lg font-bold text-primary">
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
              <p className="text-xs text-muted-foreground">{frasePraJanela(dias)}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Como ficaria com as últimas {historico.length} sugestões da IA
              </h3>
              {historico.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Esta empresa ainda não rodou fechamento com a IA.
                </p>
              ) : (
                <>
                  <div className="flex h-20 items-end gap-1">
                    {histograma.map((count, i) => {
                      const max = Math.max(...histograma, 1);
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-t ${i / 10 >= confidence ? "bg-green-500" : "bg-amber-400"}`}
                          style={{ height: `${Math.max(2, (count / max) * 100)}%` }}
                          title={`${i * 10}–${(i + 1) * 10}%: ${count} sugestões`}
                        />
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-green-700">{fechariam} fechariam sozinhas</span>
                    {" · "}
                    <span className="font-medium text-amber-700">
                      {historico.length - fechariam} iriam pra revisão
                    </span>
                  </p>
                </>
              )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="success" onClick={() => void salvar()} disabled={!data || salvando}>
            {salvando ? "Salvando…" : "Salvar modelos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Opcoes<T extends string | null>({
  opcoes,
  valor,
  onEscolher,
}: {
  opcoes: Opcao<T>[];
  valor: T;
  onEscolher: (v: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {opcoes.map((m) => {
        const ativo = valor === m.id;
        return (
          <button
            key={m.id ?? "padrao"}
            type="button"
            onClick={() => onEscolher(m.id)}
            className={`rounded-lg border-2 p-3 text-left transition-colors ${
              ativo ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            }`}
          >
            <div className="font-medium">
              {m.nome}
              {ativo && <span className="ml-2 text-xs font-medium text-primary">✓ atual</span>}
            </div>
            <div className="text-xs text-muted-foreground">{m.custoLabel}</div>
            <p className="mt-1 text-xs text-muted-foreground">{m.descricao}</p>
          </button>
        );
      })}
    </div>
  );
}
