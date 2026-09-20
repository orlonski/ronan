"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { usePermissoes } from "@/lib/permissoes";
import { diaBr, hm, PATH, PrecisaFundamento, useConfigPonto } from "../_lib";

type Linha = {
  funcionarioId: string;
  nome: string;
  saldoMin: number;
  diasParaConferir: number;
  correcoesPendentes: number;
  semJornada: boolean;
};

type Competencia = {
  competencia: { rotulo: string; de: string; ate: string };
  totalPessoas: number;
  comPendencia: number;
  linhas: Linha[];
  fechamento: { id: string; status: "ABERTO" | "FECHADO"; fechadoEm: string | null } | null;
  travas: {
    diasParaConferir: number;
    correcoesPendentes: number;
    semJornada: number;
    cienciaPendente: number;
    semFundamento: boolean;
  };
};

/**
 * FECHAR O MÊS: a visão da competência inteira, que vem ANTES da de uma
 * pessoa.
 *
 * O bloco "o que trava o fechamento" existe porque a pergunta real de quem
 * abre esta tela não é "quantas horas deu", é "posso mandar pra folha?".
 */
export default function CompetenciaPage() {
  return (
    <RequerTela chave="fechamento-ponto.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [competencia, setCompetencia] = useState(() => hojeSP().slice(0, 7));
  const [motivoReabrir, setMotivoReabrir] = useState("");
  const config = useConfigPonto();

  const q = useQuery({
    queryKey: [PATH, "competencia", competencia],
    enabled: !!token,
    queryFn: () => fetchApi<Competencia>(`${PATH}/competencia?competencia=${competencia}`, { token }),
  });

  const fechar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/fechamentos/fechar`, {
        token,
        method: "POST",
        body: JSON.stringify({ competencia }),
      }),
    onSuccess: () => {
      toast.success("Competência fechada.", {
        description: "As horas ficaram congeladas — editar jornada agora não muda este mês.",
      });
      void qc.invalidateQueries({ queryKey: [PATH, "competencia"] });
    },
    onError: (e: Error) => toast.error("Não consegui fechar", { description: e.message }),
  });

  const reabrir = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`${PATH}/fechamentos/${id}/reabrir`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo: motivoReabrir }),
      }),
    onSuccess: () => {
      toast.success("Competência reaberta.", {
        description: "As horas serão recalculadas quando você fechar de novo.",
      });
      setMotivoReabrir("");
      void qc.invalidateQueries({ queryKey: [PATH, "competencia"] });
    },
    onError: (e: Error) => toast.error("Não consegui reabrir", { description: e.message }),
  });

  if (config.data && !config.data.fundamento) return <PrecisaFundamento />;

  const d = q.data;
  const fechado = d?.fechamento?.status === "FECHADO";
  const travas = d?.travas;
  const temTrava =
    !!travas &&
    (travas.diasParaConferir > 0 ||
      travas.correcoesPendentes > 0 ||
      travas.semJornada > 0 ||
      travas.cienciaPendente > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <CalendarCheck className="h-6 w-6 text-muted-foreground" />
            Fechar o mês
          </h1>
          {d && (
            <p className="text-sm text-muted-foreground">
              Período de {diaBr(d.competencia.de)} a {diaBr(d.competencia.ate)} ·{" "}
              {d.totalPessoas} pessoa(s)
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="comp-mes">Competência</Label>
          <Input
            id="comp-mes"
            type="month"
            className="w-44"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
          />
        </div>
      </div>

      {d && (
        <>
          <Card className={`space-y-2 p-4 ${temTrava ? "border-amber-500/50 bg-amber-500/5" : ""}`}>
            <p className="font-medium">
              {temTrava ? "O que trava o fechamento" : "Nada pendente"}
            </p>
            {temTrava ? (
              <ul className="ml-4 list-disc space-y-1 text-sm">
                {travas!.diasParaConferir > 0 && (
                  <li>
                    {travas!.diasParaConferir} dia(s) a conferir — batida sem par, ou dia previsto
                    sem registro.
                  </li>
                )}
                {travas!.correcoesPendentes > 0 && (
                  <li>
                    {travas!.correcoesPendentes} correção(ões) esperando decisão.{" "}
                    <Link href="/ponto/correcoes" className="underline">
                      Ver
                    </Link>
                  </li>
                )}
                {travas!.semJornada > 0 && (
                  <li>
                    {travas!.semJornada} pessoa(s) sem jornada em algum dia — sem jornada não
                    existe previsto.
                  </li>
                )}
                {travas!.cienciaPendente > 0 && (
                  <li>
                    {travas!.cienciaPendente} correção(ões) aprovadas sem ciência da pessoa.
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pode fechar. Depois de fechado, as horas ficam congeladas.
              </p>
            )}
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Funcionário</th>
                  <th className="p-2 text-right">Saldo</th>
                  <th className="p-2 text-right">A conferir</th>
                  <th className="p-2 text-right">Correções</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {d.linhas.map((l) => (
                  <tr key={l.funcionarioId} className="border-b">
                    <td className="p-2">
                      {l.nome}
                      {l.semJornada && (
                        <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                          sem jornada
                        </span>
                      )}
                    </td>
                    <td
                      className={`p-2 text-right font-medium ${
                        l.saldoMin < 0 ? "text-amber-700 dark:text-amber-400" : ""
                      }`}
                    >
                      {hm(l.saldoMin)}
                    </td>
                    <td className="p-2 text-right">{l.diasParaConferir || "—"}</td>
                    <td className="p-2 text-right">{l.correcoesPendentes || "—"}</td>
                    <td className="p-2 text-right">
                      <Link
                        href={`/ponto/espelho/${l.funcionarioId}`}
                        className="text-sm underline"
                      >
                        Espelho
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex flex-wrap items-end gap-3">
            {!fechado && temPermissao("fechamento-ponto.fechar") && (
              <Button disabled={fechar.isPending} onClick={() => fechar.mutate()}>
                {fechar.isPending ? "Fechando…" : "Fechar a competência"}
              </Button>
            )}
            {fechado && temPermissao("fechamento-ponto.reabrir") && (
              <>
                <div className="flex-1">
                  <Label htmlFor="comp-motivo">Por que está reabrindo</Label>
                  <Input
                    id="comp-motivo"
                    className="max-w-md"
                    value={motivoReabrir}
                    onChange={(e) => setMotivoReabrir(e.target.value)}
                  />
                </div>
                <Button
                  variant="warning"
                  disabled={motivoReabrir.trim().length < 3 || reabrir.isPending}
                  onClick={() => reabrir.mutate(d.fechamento!.id)}
                >
                  {reabrir.isPending ? "Reabrindo…" : "Reabrir"}
                </Button>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Fechar congela as horas do período, como o valor da viagem: editar a jornada depois
            não muda o mês que já foi pra folha. Reabrir apaga a apuração congelada — fechar de
            novo refaz tudo com o que estiver valendo.
          </p>
        </>
      )}
    </div>
  );
}
