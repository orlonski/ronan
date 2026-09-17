"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Database, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ResultadoImport = { arquivo: string; qualificados: number; inseridos: number };
type ResultadoEnriq = {
  processados: number;
  comTelefone: number;
  naoEncontrados: number;
  falhas: number;
};
type ResultadoChatwoot = {
  candidatos: number;
  criados: number;
  jaTinham: number;
  falhas: number;
  fixos: number;
};

/**
 * As operações caras da base.
 *
 * Todas demoram e batem em serviço de fora, então a tela avisa o custo ANTES —
 * botão que parece instantâneo e trava por oito minutos faz a pessoa clicar de
 * novo, e aí são duas varreduras.
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

  const mandarProChatwoot = useMutation({
    mutationFn: () =>
      fetchApi<ResultadoChatwoot>("/admin/prospeccao/chatwoot/contatos", {
        method: "POST",
        body: JSON.stringify({}),
        token,
      }),
    onSuccess: (r) => {
      setRecado(
        r.candidatos === 0
          ? `Nada novo pra mandar — os ${r.jaTinham} leads com telefone já estão no Chatwoot.`
          : `${r.criados} contato(s) criado(s) no Chatwoot` +
            `${r.fixos > 0 ? `, ${r.fixos} deles em telefone fixo (pode não ter WhatsApp)` : ""}` +
            `${r.falhas > 0 ? `. ${r.falhas} não deram.` : "."}`,
      );
      onPronto();
    },
    onError: (e: Error) => setRecado(`Não deu: ${e.message}`),
  });

  const ocupado = importar.isPending || enriquecer.isPending || mandarProChatwoot.isPending;

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

        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setRecado(null);
            mandarProChatwoot.mutate();
          }}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/40 disabled:opacity-50"
        >
          {mandarProChatwoot.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          {mandarProChatwoot.isPending ? "Mandando pro Chatwoot…" : "Mandar contatos pro Chatwoot"}
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A busca na ANTT lê 1,1 milhão de linhas e leva cerca de meio minuto. A procura de telefone
        consulta a Receita de um em um, devagar de propósito — 200 empresas levam uns 4 minutos.
        Pode fechar a tela: as duas terminam sozinhas. Mandar pro Chatwoot cria lá os contatos
        dos leads que têm telefone, com CNPJ, cidade e nota — quem pediu pra não ser contatado
        fica de fora.
      </p>

      {recado && (
        <p className="rounded-md bg-accent/40 px-3 py-2 text-sm" role="status">
          {recado}
        </p>
      )}
    </Card>
  );
}
