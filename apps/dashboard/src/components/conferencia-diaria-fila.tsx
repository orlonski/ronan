"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Sugestao = {
  id: string;
  tipo: string;
  status: string;
  resumo: string;
  criadaEm: string;
  motorista: { id: string; nome: string; ativo: boolean } | null;
  /** O motorista tem acerto ABERTO: só um aviso antes de inativar, nunca bloqueia. */
  acertoAberto: boolean;
};

export type SemCanalItem = {
  motoristaId: string;
  nome: string;
  parou: boolean;
  inalcancavelDesde: string | null;
  /** Responderam "número errado" à pergunta. */
  numeroErrado?: boolean;
};

const PATH_SUGESTOES = "/admin/conferencia-diaria/sugestoes";
const PATH_SEM_CANAL = "/admin/conferencia-diaria/sem-canal";

const TIPO_TITULO: Record<string, string> = {
  INATIVAR_VINCULO: "Diz que saiu da empresa",
  LANCAR_VIAGEM_FALTANTE: "Diz que teve viagem e não lançou",
  RESPOSTA_AMBIGUA: "Resposta que o sistema não entendeu",
  MOTORISTA_PAROU_WHATSAPP: "Pediu pra parar de receber a pergunta",
  WHATSAPP_INALCANCAVEL: "O WhatsApp parece não chegar",
  NUMERO_ERRADO: "O número parece não ser dele",
};

function dataBR(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** A fila do gestor: o que o sistema percebeu e só uma pessoa decide. */
export function FilaDoGestor() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeDecidir = temPermissao("conferencia-diaria.decidir");
  const podeInativar = temPermissao("motoristas.editar");
  const lista = useApiQuery<Sugestao[]>(PATH_SUGESTOES);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const decidir = useMutation({
    mutationFn: ({ id, acao }: { id: string; acao: "aprovar" | "recusar" }) =>
      fetchApi(`${PATH_SUGESTOES}/${id}/${acao}`, { method: "POST", body: JSON.stringify({}), token }),
    onSuccess: (_r, v) => {
      toast.success(v.acao === "aprovar" ? "Feito." : "Sugestão descartada.");
      setConfirmando(null);
      void qc.invalidateQueries({ queryKey: [PATH_SUGESTOES, "get"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não deu pra concluir."),
  });

  if (lista.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (lista.isError) return <p className="text-sm text-destructive">Não deu pra carregar a fila.</p>;
  const itens = lista.data ?? [];
  if (itens.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nada esperando decisão. Quando um parceiro disser que saiu da empresa, que tem viagem sem lançar ou
        parar de receber a pergunta, aparece aqui.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {itens.map((s) => {
        const inativa = s.tipo === "INATIVAR_VINCULO";
        return (
          <li key={s.id}>
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{s.motorista?.nome ?? "Parceiro"}</p>
                  <p className="text-sm text-muted-foreground">{s.resumo}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge>{TIPO_TITULO[s.tipo] ?? s.tipo}</Badge>
                  <span className="text-xs text-muted-foreground">{dataBR(s.criadaEm)}</span>
                </div>
              </div>

              {inativa && confirmando === s.id && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Se você inativar o vínculo:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>ele perde o acesso ao app da sua empresa;</li>
                    <li>o histórico de viagens e os acertos continuam guardados;</li>
                    <li>dá pra reativar depois, no cadastro dele.</li>
                  </ul>
                  {s.acertoAberto && (
                    <p className="font-medium">
                      Atenção: ele tem acerto em aberto. Isso não impede de inativar — só confira o acerto depois.
                    </p>
                  )}
                </div>
              )}

              {podeDecidir && (
                <div className="flex flex-wrap justify-end gap-2">
                  {inativa ? (
                    confirmando === s.id ? (
                      <>
                        <Button variant="outline" onClick={() => setConfirmando(null)} disabled={decidir.isPending}>
                          Voltar
                        </Button>
                        <Button
                          variant="warning"
                          onClick={() => decidir.mutate({ id: s.id, acao: "aprovar" })}
                          disabled={decidir.isPending || !podeInativar}
                          title={podeInativar ? undefined : "Você precisa da permissão de editar motoristas."}
                        >
                          Inativar vínculo
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => decidir.mutate({ id: s.id, acao: "recusar" })}
                          disabled={decidir.isPending}
                        >
                          Manter ativo
                        </Button>
                        <Button variant="warning" onClick={() => setConfirmando(s.id)} disabled={!podeInativar}
                          title={podeInativar ? undefined : "Você precisa da permissão de editar motoristas."}
                        >
                          Ver o que acontece
                        </Button>
                      </>
                    )
                  ) : (
                    <>
                      {s.tipo === "NUMERO_ERRADO" && s.motorista && (
                        <Button asChild variant="default">
                          <Link href={`/motoristas/${s.motorista.id}`}>Abrir a ficha</Link>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => decidir.mutate({ id: s.id, acao: "recusar" })}
                        disabled={decidir.isPending}
                      >
                        Descartar sugestão
                      </Button>
                      <Button
                        variant="success"
                        onClick={() => decidir.mutate({ id: s.id, acao: "aprovar" })}
                        disabled={decidir.isPending}
                      >
                        Marcar como resolvida
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Quem saiu da conferência (pediu pra parar) ou não tem canal (número que não entrega). */
export function SaiuDaConferencia() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeDecidir = temPermissao("conferencia-diaria.decidir");
  const lista = useApiQuery<SemCanalItem[]>(PATH_SEM_CANAL);

  const reverificar = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/admin/conferencia-diaria/motoristas/${id}/reverificar-whatsapp`, { method: "POST", token }),
    onSuccess: () => {
      toast.success("Número reverificado. A conferência volta a perguntar a ele.");
      void qc.invalidateQueries({ queryKey: [PATH_SEM_CANAL, "get"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não deu pra reverificar."),
  });

  if (lista.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (lista.isError) return <p className="text-sm text-destructive">Não deu pra carregar a lista.</p>;
  const itens = lista.data ?? [];
  if (itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Ninguém saiu da conferência e nenhum número está suspeito.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-muted-foreground">
        Estes parceiros não recebem mais a pergunta pelo WhatsApp. A regra continua olhando as viagens deles: se
        ficarem sem lançar, aparecem em &ldquo;Sem canal&rdquo; na lista do dia, pra você contatar por outro meio.
      </p>
      <ul className="divide-y rounded-md border">
        {itens.map((i) => (
          <li key={i.motoristaId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{i.nome}</p>
              <p className="text-sm text-muted-foreground">
                {[
                  i.parou ? "Pediu pra parar de receber a pergunta" : null,
                  i.inalcancavelDesde ? `WhatsApp sem entrega desde ${dataBR(i.inalcancavelDesde)}` : null,
                  i.numeroErrado ? "O número parece não ser dele" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {i.inalcancavelDesde && podeDecidir && (
              <Button
                variant="outline"
                onClick={() => reverificar.mutate(i.motoristaId)}
                disabled={reverificar.isPending}
                title="O número está certo: volta a perguntar e ignora as mensagens antigas."
              >
                Reverificar número
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
