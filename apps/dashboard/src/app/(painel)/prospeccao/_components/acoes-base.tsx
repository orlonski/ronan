"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Database, Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ResultadoImport = { arquivo: string; qualificados: number; inseridos: number };
type ResultadoEnriq = {
  processados: number;
  comTelefone: number;
  naoEncontrados: number;
  falhas: number;
};

/**
 * As duas operações caras da base.
 *
 * Ambas demoram minutos e batem em serviço de fora, então a tela avisa o custo
 * ANTES — botão que parece instantâneo e trava por oito minutos faz a pessoa
 * clicar de novo, e aí são duas varreduras.
 */
export function AcoesBase({ onPronto }: { onPronto: () => void }) {
  const token = useAuthToken();
  const [recado, setRecado] = useState<string | null>(null);

  const importar = useMutation({
    mutationFn: () =>
      fetchApi<ResultadoImport>("/admin/prospeccao/importar-rntrc", {
        method: "POST",
        body: JSON.stringify({}),
        token,
      }),
    onSuccess: (r) => {
      setRecado(
        `${r.arquivo}: ${r.inseridos.toLocaleString("pt-BR")} empresas novas de ${r.qualificados.toLocaleString("pt-BR")} qualificadas.`,
      );
      onPronto();
    },
    onError: (e: Error) => setRecado(`Não deu: ${e.message}`),
  });

  const enriquecer = useMutation({
    mutationFn: () =>
      fetchApi<ResultadoEnriq>("/admin/prospeccao/enriquecer", {
        method: "POST",
        body: JSON.stringify({ limite: 200, scoreMinimo: 75 }),
        token,
      }),
    onSuccess: (r) => {
      setRecado(
        `${r.comTelefone} telefone(s) encontrado(s) em ${r.processados} consulta(s). ` +
          `${r.naoEncontrados} sem cadastro na Receita, ${r.falhas} falha(s).`,
      );
      onPronto();
    },
    onError: (e: Error) => setRecado(`Não deu: ${e.message}`),
  });

  const ocupado = importar.isPending || enriquecer.isPending;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setRecado(null);
            importar.mutate();
          }}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/40 disabled:opacity-50"
        >
          {importar.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Database className="h-4 w-4" />
          )}
          {importar.isPending ? "Baixando o RNTRC…" : "Buscar empresas novas na ANTT"}
        </button>

        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setRecado(null);
            enriquecer.mutate();
          }}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/40 disabled:opacity-50"
        >
          {enriquecer.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {enriquecer.isPending ? "Consultando a Receita…" : "Achar telefone dos 200 melhores"}
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A busca na ANTT lê 1,1 milhão de linhas e leva cerca de meio minuto. A procura de telefone
        consulta a Receita de um em um, devagar de propósito — 200 empresas levam uns 4 minutos.
        Pode fechar a tela: as duas terminam sozinhas.
      </p>

      {recado && (
        <p className="rounded-md bg-accent/40 px-3 py-2 text-sm" role="status">
          {recado}
        </p>
      )}
    </Card>
  );
}
