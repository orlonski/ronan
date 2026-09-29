"use client";

import { Badge } from "@/components/ui/badge";

export type SemCanal = "SEM_TELEFONE" | "NAO_ACEITA_WHATSAPP" | "PAROU" | "DESLIGADA_PAINEL" | "INALCANCAVEL";

export type ItemConferencia = {
  motoristaId: string;
  nome: string;
  deveriaPerguntar: boolean;
  motivo: string;
  /** Só na lista do dia (a simulação não grava, então não tem). */
  estado?: string;
  opcao?: string | null;
  erroEnvio?: string | null;
  /** A regra manda perguntar, mas não há como perguntar pelo WhatsApp. */
  semCanal?: SemCanal | null;
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

const MOTIVO_SEM_CANAL: Record<SemCanal, string> = {
  SEM_TELEFONE: "sem telefone cadastrado",
  NAO_ACEITA_WHATSAPP: "desligou as mensagens no WhatsApp",
  PAROU: "pediu pra parar de receber a pergunta",
  DESLIGADA_PAINEL: "a conferência está desligada pela empresa",
  INALCANCAVEL: "o WhatsApp dele parece não entregar",
};

const RESPOSTA: Record<string, string> = {
  NAO_TIVE: "Respondeu: não teve viagem",
  TIVE_NAO_LANCEI: "Respondeu: teve viagem e não lançou",
  SAI_DA_EMPRESA: "Respondeu: saiu da empresa",
  PARAR: "Pediu pra parar as perguntas",
  AMBIGUA: "Respondeu de um jeito que o sistema não entendeu",
};

/** Onde a pergunta está, em palavras de quem opera. */
function situacao(i: ItemConferencia): { texto: string; tom: "neutro" | "ok" | "atencao" } | null {
  switch (i.estado) {
    case "PENDENTE":
      return { texto: "Na fila de envio", tom: "neutro" };
    case "ENVIADA":
      return { texto: "Perguntado — esperando resposta", tom: "neutro" };
    case "RESPONDIDA":
      return { texto: (i.opcao && RESPOSTA[i.opcao]) || "Respondeu", tom: "ok" };
    case "EXPIRADA":
      return { texto: "Perguntado — sem resposta", tom: "atencao" };
    case "FALHOU":
      return { texto: "A pergunta não saiu", tom: "atencao" };
    default:
      return null;
  }
}

/**
 * Quem foi (ou seria) perguntado, quem não tem canal e, recolhido, quem foi poupado.
 *
 * "Sem canal" é quem a regra manda perguntar mas não dá pra alcançar pelo
 * WhatsApp: a empresa precisa contatar por outro meio.
 */
export function ListaConferencia({ dados }: { dados: RespostaConferencia }) {
  const semCanal = dados.itens.filter((i) => i.deveriaPerguntar && i.semCanal);
  const perguntados = dados.itens.filter((i) => i.deveriaPerguntar && !i.semCanal);
  const poupados = dados.itens.filter((i) => !i.deveriaPerguntar);
  const gravado = dados.itens.some((i) => i.estado);
  const jaSaiu = dados.itens.some((i) => ["ENVIADA", "RESPONDIDA", "EXPIRADA"].includes(i.estado ?? ""));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Dia {dataBR(dados.dia)}: {dados.itens.length} parceiro(s) avaliado(s),{" "}
        {perguntados.length} {jaSaiu ? "perguntado(s)" : "seriam perguntados"}
        {semCanal.length > 0 ? ` e ${semCanal.length} sem canal de WhatsApp` : ""}.
      </p>

      {perguntados.length === 0 ? (
        <p className="text-sm">Ninguém {jaSaiu ? "foi perguntado" : "seria perguntado"}.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {perguntados.map((i) => {
            const s = situacao(i);
            return (
              <li key={i.motoristaId} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{i.nome}</p>
                  <p className="text-sm text-muted-foreground">{i.motivo}</p>
                  {i.estado === "FALHOU" && i.erroEnvio && (
                    <p className="text-xs text-amber-700">Motivo: {i.erroEnvio}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                  {gravado && s && (
                    <Badge className={s.tom === "ok" ? "bg-emerald-100 text-emerald-800" : s.tom === "atencao" ? "bg-amber-100 text-amber-900" : ""}>
                      {s.texto}
                    </Badge>
                  )}
                  <Badge>
                    {i.evidencias?.nuncaLancou
                      ? "Nunca lançou"
                      : `Última viagem ${dataBR(i.evidencias?.ultimoDiaComViagem)}`}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {semCanal.length > 0 && (
        <div className="space-y-2" data-testid="conferencia-sem-canal">
          <h3 className="text-sm font-semibold">Sem canal de WhatsApp: contatar por outro meio</h3>
          <ul className="divide-y rounded-md border border-amber-300 bg-amber-50/50">
            {semCanal.map((i) => (
              <li key={i.motoristaId} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{i.nome}</p>
                  <p className="text-sm text-muted-foreground">{i.motivo}</p>
                </div>
                <Badge className="shrink-0 self-start bg-amber-100 text-amber-900">
                  Sem canal: {i.semCanal ? MOTIVO_SEM_CANAL[i.semCanal] : ""}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
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
