"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileClock } from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { diaBr, duracao, hm, PATH } from "../../_lib";

type Par = {
  entrada: string;
  saida: string | null;
  emAberto: boolean;
  minutos: number;
  numeros: number[];
  /** Veio de correção aprovada, não do registro do trabalhador. */
  entradaIncluida: boolean;
  saidaIncluida: boolean;
};
type DiaEspelho = {
  dia: string;
  futuro: boolean;
  pares: Par[];
  minutosTrabalhados: number;
  minutosConsiderados: number;
  minutosPrevistos: number;
  saldoMin: number;
  nomeModelo: string;
  alertas: { codigo: string }[];
};

type Espelho = {
  nome: string;
  cpf: string;
  cargo: string | null;
  matricula: string | null;
  empresa: { razaoSocial: string; cnpj: string };
  competencia: { rotulo: string; de: string; ate: string };
  dias: DiaEspelho[];
  totalPrevistoMin: number;
  totalTrabalhadoMin: number;
  totalConsideradoMin: number;
  saldoMin: number;
  diasParaConferir: number;
  fechado: boolean;
  ciencia: { cienteEm: string; concorda: boolean; observacao: string | null } | null;
  correcoes: { id: string; dia: string; tipo: string; motivo: string; status: string; cienciaEm: string | null }[];
};

const TEXTO_ALERTA: Record<string, string> = {
  CONFERIR: "faltou fechar uma batida",
  SEM_REGISTRO: "dia previsto sem registro",
  FORA_DA_JORNADA: "registrou em dia sem previsão",
  SEM_INTERVALO: "intervalo menor que o mínimo",
  RELOGIO_DIVERGENTE: "relógio do aparelho divergente",
  DIRECAO_CONTINUA: "direção contínua acima do limite",
  INTERJORNADA_CURTA: "descanso entre jornadas curto",
};

function hora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * O ESPELHO DE PONTO de uma pessoa: o documento que ela confere e que a
 * fiscalização lê.
 *
 * O calendário vem COMPLETO, com os dias em branco presentes — dia que some
 * do espelho é dia que ninguém confere.
 */
export default function EspelhoPage({ params }: { params: Promise<{ funcionarioId: string }> }) {
  const { funcionarioId } = use(params);
  return (
    <RequerTela chave="espelho-ponto.ver">
      <Conteudo funcionarioId={funcionarioId} />
    </RequerTela>
  );
}

function Conteudo({ funcionarioId }: { funcionarioId: string }) {
  const token = useAuthToken();
  const [competencia, setCompetencia] = useState(() => hojeSP().slice(0, 7));

  const q = useQuery({
    queryKey: [PATH, "espelho", funcionarioId, competencia],
    enabled: !!token,
    queryFn: () =>
      fetchApi<Espelho>(`${PATH}/espelho/${funcionarioId}?competencia=${competencia}`, { token }),
  });

  const e = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FileClock className="h-6 w-6 text-muted-foreground" />
            {e?.nome ?? "Espelho de ponto"}
          </h1>
          {e && (
            <p className="text-sm text-muted-foreground">
              CPF {e.cpf}
              {e.matricula ? ` · matrícula ${e.matricula}` : ""}
              {e.cargo ? ` · ${e.cargo}` : ""} · {e.empresa.razaoSocial}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="esp-comp">Competência</Label>
          <Input
            id="esp-comp"
            type="month"
            className="w-44"
            value={competencia}
            onChange={(ev) => setCompetencia(ev.target.value)}
          />
        </div>
      </div>

      {e && (
        <>
          <div className="flex flex-wrap gap-4 rounded border p-3 text-sm">
            <span>
              Período <strong>{diaBr(e.competencia.de)} a {diaBr(e.competencia.ate)}</strong>
            </span>
            <span>
              Previsto <strong>{duracao(e.totalPrevistoMin)}</strong>
            </span>
            <span>
              Trabalhado <strong>{duracao(e.totalConsideradoMin)}</strong>
            </span>
            <span className={e.saldoMin < 0 ? "text-amber-700 dark:text-amber-400" : ""}>
              Saldo <strong>{hm(e.saldoMin)}</strong>
            </span>
            {e.diasParaConferir > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                <strong>{e.diasParaConferir}</strong> dia(s) a conferir
              </span>
            )}
            {e.fechado && <span className="font-medium">competência fechada</span>}
          </div>

          {e.ciencia && (
            <div
              className={`rounded border p-3 text-sm ${
                e.ciencia.concorda ? "border-emerald-600/40 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5"
              }`}
            >
              {e.ciencia.concorda
                ? "O funcionário conferiu e concordou com este espelho."
                : "O funcionário conferiu e NÃO concordou."}
              {e.ciencia.observacao ? ` — "${e.ciencia.observacao}"` : ""}
            </div>
          )}

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Dia</th>
                  <th className="p-2">Batidas</th>
                  <th className="p-2 text-right">Previsto</th>
                  <th className="p-2 text-right">Trabalhado</th>
                  <th className="p-2 text-right">Saldo</th>
                  <th className="p-2">Observação</th>
                </tr>
              </thead>
              <tbody>
                {e.dias.map((d) => (
                  <tr
                    key={d.dia}
                    className={`border-b align-top ${d.futuro ? "text-muted-foreground" : ""}`}
                  >
                    <td className="p-2 whitespace-nowrap">{diaBr(d.dia)}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {d.pares.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          d.pares.map((p, i) => (
                            <span key={i} className="rounded border px-2 py-0.5 font-mono text-xs">
                              {/* O que foi INCLUÍDO por correção não pode sair
                                  igual ao que o trabalhador registrou: num
                                  documento de jornada, essa é a distinção que
                                  mais importa na linha. */}
                              <span
                                className={p.entradaIncluida ? "font-bold text-blue-700" : ""}
                                title={p.entradaIncluida ? "incluído por correção" : undefined}
                              >
                                {hora(p.entrada)}
                                {p.entradaIncluida ? "*" : ""}
                              </span>
                              {p.saida ? (
                                <span
                                  className={p.saidaIncluida ? "font-bold text-blue-700" : ""}
                                  title={p.saidaIncluida ? "incluído por correção" : undefined}
                                >
                                  {`–${hora(p.saida)}${p.saidaIncluida ? "*" : ""}`}
                                </span>
                              ) : (
                                " – ?"
                              )}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="p-2 text-right">{duracao(d.minutosPrevistos)}</td>
                    <td className="p-2 text-right">{duracao(d.minutosConsiderados)}</td>
                    <td
                      className={`p-2 text-right ${
                        d.saldoMin < 0 ? "text-amber-700 dark:text-amber-400" : ""
                      }`}
                    >
                      {hm(d.saldoMin)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {d.futuro
                        ? "ainda não aconteceu"
                        : d.alertas.map((a) => TEXTO_ALERTA[a.codigo] ?? a.codigo).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {e.correcoes.length > 0 && (
            <Card className="space-y-2 p-4">
              <p className="font-medium">Correções no período</p>
              {e.correcoes.map((c) => (
                <div key={c.id} className="flex flex-wrap gap-2 border-b py-1 text-sm last:border-0">
                  <span className="w-16">{diaBr(c.dia)}</span>
                  <span className="w-36">{c.tipo}</span>
                  <span className="flex-1">{c.motivo}</span>
                  <span className="text-muted-foreground">{c.status}</span>
                  {c.status === "APROVADA" && !c.cienciaEm && (
                    <span className="text-amber-700 dark:text-amber-400">ciência pendente</span>
                  )}
                </div>
              ))}
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Horário com <strong>*</strong> foi incluído por correção — não foi o funcionário que
            registrou. As batidas vêm do registro do próprio funcionário e não podem ser alteradas — nem por
            nós. O que muda a conta é a correção, que é sempre linha nova, com autor e motivo.
          </p>
        </>
      )}
    </div>
  );
}
