"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { AbasDaTela } from "@/components/abas-da-tela";
import { Card } from "@/components/ui/card";
import { useApiQuery } from "@/lib/client-api";
import { ListaConferencia, type RespostaConferencia } from "@/components/conferencia-diaria-lista";
import { FilaDoGestor, SaiuDaConferencia } from "@/components/conferencia-diaria-fila";

type Aba = "hoje" | "fila" | "saiu";

export default function ConferenciaDiariaPage() {
  return (
    <RequerTela chave="conferencia-diaria.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const abaDaUrl = useSearchParams().get("aba");
  const [aba, setAba] = useState<Aba>(abaDaUrl === "fila" || abaDaUrl === "saiu" ? abaDaUrl : "hoje");
  const hoje = useApiQuery<RespostaConferencia>("/admin/conferencia-diaria/hoje");
  const fila = useApiQuery<unknown[]>("/admin/conferencia-diaria/sugestoes");
  const naFila = Array.isArray(fila.data) ? fila.data.length : 0;
  const algoEnviado = hoje.data?.itens.some((i) =>
    ["PENDENTE", "ENVIADA", "RESPONDIDA", "EXPIRADA"].includes(i.estado ?? ""),
  );

  const abas: [Aba, string][] = [
    ["hoje", "Hoje"],
    ["fila", naFila > 0 ? `Fila do gestor (${naFila})` : "Fila do gestor"],
    ["saiu", "Saiu da conferência / sem canal"],
  ];

  return (
    <div className="space-y-6">
      <AbasDaTela grupo="viagens" />
      <div>
        <h1 className="text-2xl font-bold">Esqueceu de lançar?</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Os parceiros que provavelmente esqueceram de lançar viagem, pelo histórico de cada um.
          A regra (quando confere, o que conta como falta, se pergunta pelo WhatsApp) é ajustada em
          &ldquo;Quando perguntar&rdquo;.
        </p>
      </div>

      <div role="tablist" className="flex flex-wrap gap-2 border-b">
        {abas.map(([chave, rotulo]) => (
          <button
            key={chave}
            role="tab"
            aria-selected={aba === chave}
            onClick={() => setAba(chave)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              aba === chave ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "hoje" && (
        <>
          {hoje.data?.rodou && !algoEnviado && (
            <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <strong>Hoje nada foi enviado.</strong> A conferência estava só registrando quem seria
                perguntado (ou o WhatsApp não estava pronto).
              </p>
            </div>
          )}
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-semibold">Quem a conferência olhou hoje</h2>
            {hoje.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {hoje.isError && <p className="text-sm text-destructive">Não deu pra carregar a lista.</p>}
            {hoje.data && !hoje.data.rodou && (
              <p className="text-sm text-muted-foreground">
                A conferência ainda não rodou hoje. Ela roda na hora escolhida, nos dias escolhidos, e só
                quando está ligada.
              </p>
            )}
            {hoje.data?.rodou && <ListaConferencia dados={hoje.data} />}
          </Card>
        </>
      )}

      {aba === "fila" && (
        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">O que espera uma decisão sua</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            O sistema nunca inativa nem muda cadastro sozinho por causa de uma resposta no WhatsApp: ele
            sugere, e você decide.
          </p>
          <FilaDoGestor />
        </Card>
      )}

      {aba === "saiu" && (
        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Saiu da conferência / sem canal</h2>
          <SaiuDaConferencia />
        </Card>
      )}
    </div>
  );
}
