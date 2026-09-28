"use client";

import { AlertTriangle } from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { AbasDaTela } from "@/components/abas-da-tela";
import { Card } from "@/components/ui/card";
import { useApiQuery } from "@/lib/client-api";
import { ListaConferencia, type RespostaConferencia } from "@/components/conferencia-diaria-lista";

export default function ConferenciaDiariaPage() {
  return (
    <RequerTela chave="conferencia-diaria.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const hoje = useApiQuery<RespostaConferencia>("/admin/conferencia-diaria/hoje");

  return (
    <div className="space-y-6">
      <AbasDaTela grupo="viagens" />
      <div>
        <h1 className="text-2xl font-bold">Esqueceu de lançar?</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Os parceiros que provavelmente esqueceram de lançar viagem, pelo histórico de cada um.
          A regra (quando confere, o que conta como falta) é ajustada em &ldquo;Quando perguntar&rdquo;.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong>Modo sombra: nesta etapa nada é enviado.</strong> O sistema só registra quem seria
          perguntado, pra você conferir se a regra está acertando antes de ligar o envio.
        </p>
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold">Quem seria perguntado hoje</h2>
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
    </div>
  );
}
