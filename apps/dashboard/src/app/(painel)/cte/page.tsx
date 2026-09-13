"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, CircleAlert, Clock, FileText, FlaskConical } from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Documento = {
  id: string;
  viagemId: string | null;
  modelo: string;
  serie: number;
  numero: number;
  chave: string;
  ambiente: number;
  emissor: string;
  status: "RASCUNHO" | "ENVIADO" | "AUTORIZADO" | "REJEITADO" | "CANCELADO" | "ERRO";
  protocolo: string | null;
  autorizadoEm: string | null;
  codigoRetorno: string | null;
  motivo: string | null;
  criadoEm: string;
};

const VISUAL: Record<
  Documento["status"],
  { rotulo: string; classe: string; Icone: typeof CheckCircle2 }
> = {
  AUTORIZADO: { rotulo: "Autorizado", classe: "bg-emerald-100 text-emerald-800", Icone: CheckCircle2 },
  REJEITADO: { rotulo: "Rejeitado", classe: "bg-red-100 text-red-800", Icone: CircleAlert },
  ERRO: { rotulo: "Falhou no envio", classe: "bg-amber-100 text-amber-800", Icone: CircleAlert },
  ENVIADO: { rotulo: "Enviado", classe: "bg-blue-100 text-blue-800", Icone: Clock },
  RASCUNHO: { rotulo: "Rascunho", classe: "bg-slate-100 text-slate-700", Icone: FileText },
  CANCELADO: { rotulo: "Cancelado", classe: "bg-slate-200 text-slate-700", Icone: Ban },
};

export default function CtePage() {
  return (
    <RequerTela chave="cte.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const [status, setStatus] = React.useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["cte", "lista", status],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<Documento[]>(`/admin/cte${status ? `?status=${status}` : ""}`, { token: token! }),
  });

  const itens = data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CT-e emitidos</h1>
          <p className="text-sm text-muted-foreground">
            O que saiu daqui, com o que a SEFAZ respondeu. A emissão acontece na viagem.
          </p>
        </div>
        <Link href="/configuracoes/cte" className="text-sm text-muted-foreground underline">
          Configurar emissão
        </Link>
      </header>

      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-xs">
        <option value="">Todos os status</option>
        <option value="AUTORIZADO">Autorizados</option>
        <option value="REJEITADO">Rejeitados</option>
        <option value="ERRO">Falharam no envio</option>
        <option value="CANCELADO">Cancelados</option>
      </Select>

      {isLoading && <LoadingCard />}

      {!isLoading && itens.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Nenhum CT-e emitido ainda</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            A emissão fica na tela da viagem, no botão “Emitir CT-e”. Antes disso, confira a{" "}
            <Link href="/configuracoes/cte" className="underline">
              configuração de emissão
            </Link>
            .
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {itens.map((d) => {
          const vis = VISUAL[d.status];
          return (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      Nº {d.numero} · série {d.serie}
                    </span>
                    <Badge className={`border-transparent ${vis.classe}`}>
                      <vis.Icone className="mr-1 h-3 w-3" />
                      {vis.rotulo}
                    </Badge>
                    {/* Saber por onde saiu é o que explica um documento que
                        existe aqui e não existe na SEFAZ. */}
                    {d.emissor === "SIMULADOR" && (
                      <Badge className="border-transparent bg-purple-100 text-purple-800">
                        <FlaskConical className="mr-1 h-3 w-3" />
                        Simulado
                      </Badge>
                    )}
                    {d.ambiente === 2 && (
                      <Badge className="border-transparent bg-slate-100 text-slate-600">
                        Homologação
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {d.chave}
                  </p>

                  {/* O motivo da rejeição é a informação inteira: sem ele, a
                      pessoa reemite o mesmo documento errado. */}
                  {d.motivo && d.status !== "AUTORIZADO" && (
                    <p className="mt-2 text-sm text-destructive">
                      {d.codigoRetorno ? `${d.codigoRetorno} — ` : ""}
                      {d.motivo}
                    </p>
                  )}
                  {d.protocolo && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Protocolo {d.protocolo}
                      {d.autorizadoEm
                        ? ` · ${new Date(d.autorizadoEm).toLocaleString("pt-BR")}`
                        : ""}
                    </p>
                  )}
                </div>

                {d.viagemId && (
                  <Link
                    href={`/viagens/${d.viagemId}`}
                    className="text-sm text-muted-foreground underline"
                  >
                    Ver viagem
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
