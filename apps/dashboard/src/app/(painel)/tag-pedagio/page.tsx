"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { RequerTela } from "@/components/requer-tela";
import { cn } from "@/lib/utils";
import { Faturas } from "./_components/faturas";
import { CasarPassagens } from "./_components/casar-passagens";
import { PracasAConfirmar } from "./_components/pracas-a-confirmar";
import { Caminhoes } from "./_components/caminhoes";

/**
 * Conferência da tag de pedágio (módulo `tag-pedagio`). A fatura do Sem Parar
 * entra uma vez por mês; o servidor lê com 6 checagens, liga as passagens às
 * viagens e separa o dinheiro em três caixas. Nada aqui afirma: tudo é
 * sugestão pra conferir, e toda decisão tem autor e pode ser desfeita.
 * Desenho: docs/tag-pedagio/03-proposta.md (Onda 1).
 */

const ABAS = [
  { id: "faturas", rotulo: "Faturas e raio-x" },
  { id: "casar", rotulo: "Casar passagens com viagens" },
  { id: "pracas", rotulo: "Praças a confirmar" },
  { id: "caminhoes", rotulo: "Eixos dos caminhões" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

export default function TagPedagioPage() {
  return (
    <RequerTela chave="tag.ver">
      <React.Suspense>
        <Conteudo />
      </React.Suspense>
    </RequerTela>
  );
}

function Conteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const aba = (ABAS.find((a) => a.id === params.get("aba"))?.id ?? "faturas") as Aba;
  const extrato = params.get("extrato");
  const placa = params.get("placa");
  const dia = params.get("dia");

  const ir = React.useCallback(
    (mudar: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(mudar)) {
        if (v == null) p.delete(k);
        else p.set(k, v);
      }
      router.replace(`/tag-pedagio?${p.toString()}` as Route, { scroll: false });
    },
    [params, router],
  );

  return (
    <div className="space-y-4 max-2xl:space-y-3">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tag de pedágio</h1>
        <p className="text-sm text-muted-foreground">
          A fatura do Sem Parar conferida: cada passagem ligada à viagem certa, o vale-pedágio que o contratante deixou
          de dar e o que dá pra contestar antes do prazo. Tudo aqui é sugestão pra você conferir.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Partes da conferência">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => ir({ aba: a.id })}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              aba === a.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={aba === a.id ? "page" : undefined}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === "faturas" && (
        <Faturas
          extratoId={extrato}
          onEscolher={(id) => ir({ extrato: id })}
          onCasar={(p) => ir({ aba: "casar", placa: p, dia: null })}
        />
      )}
      {aba === "casar" && <CasarPassagens extratoId={extrato} placa={placa} dia={dia} onIr={ir} />}
      {aba === "pracas" && <PracasAConfirmar />}
      {aba === "caminhoes" && <Caminhoes />}
    </div>
  );
}
