"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, LifeBuoy, Trash2 } from "lucide-react";
import type { LancamentoResgatadoItem } from "@ronan/shared-types";
import { Permitido } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Status = "abertos" | "resolvidos" | "todos";

const TIPO_LABEL: Record<string, string> = {
  viagem: "Viagem",
  "viagem-iniciar": "Início de viagem",
  "viagem-finalizar": "Fim de viagem",
  pedagio: "Pedágio",
  abastecimento: "Abastecimento",
  local: "Local",
  "completar-peso": "Peso da viagem",
};

const RESOLUCAO_LABEL: Record<string, string> = {
  SUBIU_SOZINHO: "Entrou sozinho",
  LANCADO_NO_PAINEL: "Lançado no painel",
  DESCARTADO: "Descartado",
};

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default function LancamentosTravadosPage() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("abertos");
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");

  const lista = useQuery({
    queryKey: ["lancamentos-resgatados", status],
    enabled: !!token,
    queryFn: () =>
      fetchApi<LancamentoResgatadoItem[]>(
        `/admin/lancamentos-resgatados?status=${status}&limit=200`,
        { token },
      ),
  });

  const resolver = useMutation({
    mutationFn: (args: { id: string; resolucao: "LANCADO_NO_PAINEL" | "DESCARTADO" }) =>
      fetchApi(`/admin/lancamentos-resgatados/${args.id}/resolver`, {
        method: "POST",
        token,
        body: JSON.stringify({
          resolucao: args.resolucao,
          observacao: observacao || undefined,
        }),
      }),
    onSuccess: () => {
      setResolvendo(null);
      setObservacao("");
      void qc.invalidateQueries({ queryKey: ["lancamentos-resgatados"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <LifeBuoy size={24} /> Lançamentos travados
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Cópia de segurança do que o app do motorista não conseguiu enviar. O
            lançamento continua no celular dele — isto aqui existe pra que ele não
            se perca se o motorista descartar, trocar de aparelho ou reinstalar o
            app. Quando o envio acaba dando certo, o caso fecha sozinho.
          </p>
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          className="w-48"
        >
          <option value="abertos">Em aberto</option>
          <option value="resolvidos">Resolvidos</option>
          <option value="todos">Todos</option>
        </Select>
      </div>

      {lista.isLoading && <LoadingCard />}

      {lista.data?.length === 0 && (
        <Card>
          <p className="py-6 text-center text-sm text-muted-foreground">
            {status === "abertos"
              ? "Nenhum lançamento travado. É assim que tem que estar."
              : "Nada por aqui."}
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {lista.data?.map((item) => {
          const faltando = item.campos.filter((c) => c.existe === false);
          return (
            <Card key={item.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold">
                      {TIPO_LABEL[item.tipo] ?? item.tipo}
                    </span>
                    <Badge className="border-border bg-muted">{item.motorista.nome}</Badge>
                    {item.resolucao && (
                      <Badge>{RESOLUCAO_LABEL[item.resolucao] ?? item.resolucao}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lançado em {dataHora(item.criadoOfflineEm)} · guardado aqui em{" "}
                    {dataHora(item.recebidoEm)}
                    {item.appVersao ? ` · app ${item.appVersao}` : ""}
                  </p>
                </div>
                {!item.resolvidoEm && (
                  <Permitido chave="lancamentos-resgatados.resolver">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => setResolvendo(resolvendo === item.id ? null : item.id)}
                      >
                        Encerrar caso
                      </Button>
                    </div>
                  </Permitido>
                )}
              </div>

              {/* O motivo da recusa, do jeito que o motorista leu no celular. */}
              {item.erroMensagem && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">
                    {item.erroMensagem}
                    {item.erroStatus ? ` (${item.erroStatus})` : ""}
                  </p>
                </div>
              )}

              {/* Cadastro que sumiu = quase sempre a explicação inteira do caso. */}
              {faltando.length > 0 && (
                <p className="text-sm">
                  <span className="font-semibold">Não existe mais: </span>
                  {faltando.map((c) => c.rotulo).join(", ")}
                </p>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
                {item.campos.map((c) => (
                  <div key={c.rotulo}>
                    <dt className="text-xs text-muted-foreground">{c.rotulo}</dt>
                    <dd className={c.existe === false ? "text-destructive" : ""}>{c.valor}</dd>
                  </div>
                ))}
              </dl>

              {resolvendo === item.id && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                  <p className="text-sm">
                    Como este caso foi resolvido? Isso não mexe no celular do
                    motorista — só tira da lista daqui.
                  </p>
                  <Textarea
                    value={observacao}
                    onChange={(e) => setObservacao(e.target.value)}
                    placeholder="Observação (opcional): o que foi feito"
                    rows={2}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={resolver.isPending}
                      onClick={() =>
                        resolver.mutate({ id: item.id, resolucao: "LANCADO_NO_PAINEL" })
                      }
                    >
                      <Check size={16} /> Lancei na mão
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={resolver.isPending}
                      onClick={() =>
                        resolver.mutate({ id: item.id, resolucao: "DESCARTADO" })
                      }
                    >
                      <Trash2 size={16} /> Descartar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setResolvendo(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              {item.resolvidoEm && (
                <p className="text-xs text-muted-foreground">
                  Encerrado em {dataHora(item.resolvidoEm)}
                  {item.resolvidoPorNome ? ` por ${item.resolvidoPorNome}` : ""}
                  {item.observacao ? ` — ${item.observacao}` : ""}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
