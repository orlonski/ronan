"use client";

import { Badge } from "@/components/ui/badge";

export type ItemConferencia = {
  motoristaId: string;
  nome: string;
  deveriaPerguntar: boolean;
  motivo: string;
  evidencias: {
    ultimoDiaComViagem: string | null;
    nuncaLancou: boolean;
    diasEsperadosVerificados: string[];
  } | null;
};

export type RespostaConferencia = {
  dia: string;
  rodou?: boolean;
  itens: ItemConferencia[];
};

function dataBR(y: string | null | undefined): string {
  if (!y) return "—";
  const [a, m, d] = y.split("-");
  return `${d}/${m}/${a}`;
}

/** Quem seria perguntado (com o motivo) e, recolhido, quem foi poupado. */
export function ListaConferencia({ dados }: { dados: RespostaConferencia }) {
  const seriam = dados.itens.filter((i) => i.deveriaPerguntar);
  const poupados = dados.itens.filter((i) => !i.deveriaPerguntar);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Dia {dataBR(dados.dia)}: {dados.itens.length} parceiro(s) avaliado(s), {seriam.length} seriam
        perguntados.
      </p>

      {seriam.length === 0 ? (
        <p className="text-sm">Ninguém seria perguntado.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {seriam.map((i) => (
            <li key={i.motoristaId} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium">{i.nome}</p>
                <p className="text-sm text-muted-foreground">{i.motivo}</p>
              </div>
              <Badge className="shrink-0 self-start">
                {i.evidencias?.nuncaLancou
                  ? "Nunca lançou"
                  : `Última viagem ${dataBR(i.evidencias?.ultimoDiaComViagem)}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {poupados.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Quem foi poupado ({poupados.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {poupados.map((i) => (
              <li key={i.motoristaId}>
                <span className="font-medium">{i.nome}</span>
                <span className="text-muted-foreground"> — {i.motivo}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
