"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirmarTelefones } from "@/components/numero-confirmado";
import { usePermissoes } from "@/lib/permissoes";

export type SemCanal =
  | "SEM_TELEFONE"
  | "NAO_ACEITA_WHATSAPP"
  | "PAROU"
  | "DESLIGADA_PAINEL"
  | "INALCANCAVEL"
  | "NUMERO_ERRADO";

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
  /** Barrado pela regra de atividade: não recebe mensagem, o escritório decide. */
  semMovimento?: boolean;
  /** Pela regra seria perguntado, mas o número não está confirmado: não recebe mensagem, o escritório confirma antes. */
  naoConfirmado?: boolean;
  telefoneMascarado?: string | null;
  evidencias: {
    ultimoDiaComViagem: string | null;
    nuncaLancou: boolean;
    diasEsperadosVerificados: string[];
    diasSemMovimento?: number;
  } | null;
};

export type RespostaConferencia = {
  dia: string;
  rodou?: boolean;
  /** O N da regra de atividade da empresa (0 = desligada). Vem da config, nunca de constante. */
  janelaAtividadeDias?: number;
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
  NUMERO_ERRADO: "o número parece não ser dele",
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
  const { temPermissao } = usePermissoes();
  const podeConfirmar = temPermissao("conferencia-diaria.decidir");
  // Confirmados agora: somem do grupo na hora (a simulação não recarrega; a lista do dia recarrega sozinha).
  const [confirmadosAgora, setConfirmadosAgora] = useState<Set<string>>(new Set());
  const [confirmandoTodos, setConfirmandoTodos] = useState(false);
  const confirmar = useConfirmarTelefones((_r, ids) => {
    setConfirmadosAgora((antes) => new Set([...antes, ...ids]));
    setConfirmandoTodos(false);
  });

  const semMovimento = dados.itens.filter((i) => i.semMovimento);
  const naoConfirmados = dados.itens.filter((i) => i.naoConfirmado && !i.semMovimento && !confirmadosAgora.has(i.motoristaId));
  const semCanal = dados.itens.filter((i) => !i.semMovimento && !i.naoConfirmado && i.deveriaPerguntar && i.semCanal);
  const perguntados = dados.itens.filter((i) => !i.semMovimento && !i.naoConfirmado && i.deveriaPerguntar && !i.semCanal);
  const poupados = dados.itens.filter((i) => !i.semMovimento && !i.naoConfirmado && !i.deveriaPerguntar);
  const janela = dados.janelaAtividadeDias ?? 0;
  const gravado = dados.itens.some((i) => i.estado);
  const jaSaiu = dados.itens.some((i) => ["ENVIADA", "RESPONDIDA", "EXPIRADA"].includes(i.estado ?? ""));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Dia {dataBR(dados.dia)}: {dados.itens.length} parceiro(s) avaliado(s),{" "}
        {perguntados.length} {jaSaiu ? "perguntado(s)" : "seriam perguntados"}
        {semCanal.length > 0 ? ` e ${semCanal.length} sem canal de WhatsApp` : ""}
        {semMovimento.length > 0 ? `${semCanal.length > 0 ? "," : " e"} ${semMovimento.length} sem movimento` : ""}
        {naoConfirmados.length > 0 ? ` e ${naoConfirmados.length} com número não confirmado` : ""}.
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

      {naoConfirmados.length > 0 && (
        <div className="space-y-2" data-testid="conferencia-nao-confirmado">
          <h3 className="text-sm font-semibold">
            Número não confirmado — o escritório confirma antes de perguntar (não recebem mensagem)
          </h3>
          <p className="text-xs text-muted-foreground">
            Estes parceiros ainda não usaram o app nem responderam no WhatsApp, então ninguém garantiu que o telefone é
            deles. Confirmando, eles passam a receber a pergunta.
          </p>
          <ul className="divide-y rounded-md border border-slate-300 bg-slate-50/60">
            {naoConfirmados.map((i) => (
              <li key={i.motoristaId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{i.nome}</p>
                  <p className="text-sm text-muted-foreground">{i.telefoneMascarado ?? "sem telefone"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/motoristas/${i.motoristaId}`}
                    className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
                  >
                    Abrir a ficha
                  </Link>
                  {podeConfirmar && (
                    <Button
                      variant="success"
                      size="sm"
                      disabled={confirmar.isPending}
                      onClick={() => confirmar.mutate([i.motoristaId])}
                      data-testid="confirmar-numero-linha"
                    >
                      Confirmar número
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {podeConfirmar &&
            (confirmandoTodos ? (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900" role="alert" data-testid="confirmar-todos-confirmacao">
                <p className="text-sm font-medium">
                  Confirmar {naoConfirmados.length} {naoConfirmados.length === 1 ? "número" : "números"} desta lista.
                </p>
                <p className="text-sm">Você garante que estes telefones são dos motoristas.</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    disabled={confirmar.isPending}
                    onClick={() => confirmar.mutate(naoConfirmados.map((i) => i.motoristaId))}
                    data-testid="confirmar-todos"
                  >
                    {confirmar.isPending ? "Confirmando…" : "Confirmar todos"}
                  </Button>
                  <Button variant="outline" disabled={confirmar.isPending} onClick={() => setConfirmandoTodos(false)}>
                    Voltar
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setConfirmandoTodos(true)} data-testid="confirmar-todos-abrir">
                Confirmar os {naoConfirmados.length} números desta lista
              </Button>
            ))}
        </div>
      )}

      {semMovimento.length > 0 && (
        <div className="space-y-2" data-testid="conferencia-sem-movimento">
          <h3 className="text-sm font-semibold">
            {janela > 0 ? `Sem movimento há mais de ${janela} dias` : "Sem movimento há bastante tempo"} — o escritório decide (não
            recebem mensagem)
          </h3>
          <p className="text-xs text-muted-foreground">
            Se a pessoa não trabalha mais aqui, abra a ficha e inative o cadastro. Ninguém desta lista recebe mensagem.
          </p>
          <ul className="divide-y rounded-md border border-slate-300 bg-slate-50/60">
            {semMovimento.map((i) => (
              <li key={i.motoristaId} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{i.nome}</p>
                  <p className="text-sm text-muted-foreground">
                    Última viagem {dataBR(i.evidencias?.ultimoDiaComViagem)}
                    {i.evidencias?.diasSemMovimento != null ? ` (há ${i.evidencias.diasSemMovimento} dias)` : ""}
                    {i.telefoneMascarado ? ` · ${i.telefoneMascarado}` : " · sem telefone"}
                  </p>
                </div>
                <Link
                  href={`/motoristas/${i.motoristaId}`}
                  className="shrink-0 self-start rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
                >
                  Abrir a ficha
                </Link>
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
