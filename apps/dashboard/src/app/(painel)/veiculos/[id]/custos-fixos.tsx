"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TIPO_CUSTO_FIXO_LABEL, TIPOS_CUSTO_FIXO } from "@ronan/shared-types";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { usePermissoes } from "@/lib/permissoes";

/**
 * O que o caminhão custa por mês, rodando ou parado: IPVA, seguro, parcela,
 * salário de quem é registrado. A API existia desde o financeiro e não tinha
 * tela — e sem isto o lucro por caminhão sai maior do que é.
 *
 * Custo que parou se ENCERRA, não se apaga: apagar tiraria o custo dos meses em
 * que ele valeu, e o lucro do passado mudaria sozinho.
 */

type CustoFixo = {
  id: string;
  tipo: string;
  valorMensal: string;
  vigenciaDe: string;
  vigenciaAte: string | null;
  observacao: string | null;
};

const brl = (v: string | number) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const rotulo = (tipo: string) =>
  TIPO_CUSTO_FIXO_LABEL[tipo as keyof typeof TIPO_CUSTO_FIXO_LABEL] ?? tipo;

/** "1.234,56" → 1234.56. Vazio ou inválido → null. */
function parseValor(v: string): number | null {
  const t = v.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function CustosFixosDoCaminhao({ veiculoId }: { veiculoId: string }) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { temPermissao, temModulo } = usePermissoes();
  const verLucro = temPermissao("lucro-caminhao.ver") && temModulo("lucro-caminhao.ver");

  const [criando, setCriando] = React.useState(false);
  const [tipo, setTipo] = React.useState<string>("");
  const [valor, setValor] = React.useState("");
  const [desde, setDesde] = React.useState(hojeSP());
  const [salvando, setSalvando] = React.useState(false);
  const [encerrando, setEncerrando] = React.useState<{ id: string; ate: string } | null>(null);
  const [apagando, setApagando] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: ["custos-fixos", veiculoId],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<CustoFixo[]>(`/admin/custos-veiculo?veiculoId=${veiculoId}`, { token: token! }),
  });

  const recarregar = () => queryClient.invalidateQueries({ queryKey: ["custos-fixos", veiculoId] });

  async function criar() {
    if (!token) return;
    if (!tipo) return toast.error("Escolha qual é o custo.");
    const n = parseValor(valor);
    if (n == null) return toast.error("Informe quanto custa por mês.");
    setSalvando(true);
    try {
      await fetchApi("/admin/custos-veiculo", {
        token,
        method: "POST",
        body: JSON.stringify({ veiculoId, tipo, valorMensal: n, vigenciaDe: desde }),
      });
      toast.success("Custo cadastrado.");
      setCriando(false);
      setTipo("");
      setValor("");
      await recarregar();
    } catch (e) {
      toast.error("Não consegui salvar", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSalvando(false);
    }
  }

  async function encerrar() {
    if (!token || !encerrando) return;
    try {
      await fetchApi(`/admin/custos-veiculo/${encerrando.id}/encerrar`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ vigenciaAte: encerrando.ate }),
      });
      toast.success("Custo encerrado. Os meses em que ele valeu continuam na conta.");
      setEncerrando(null);
      await recarregar();
    } catch (e) {
      toast.error("Não consegui encerrar", { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function apagar(id: string) {
    if (!token) return;
    try {
      await fetchApi(`/admin/custos-veiculo/${id}`, { token, method: "DELETE" });
      toast.success("Custo apagado.");
      setApagando(null);
      await recarregar();
    } catch (e) {
      toast.error("Não consegui apagar", { description: e instanceof Error ? e.message : undefined });
    }
  }

  const custos = q.data ?? [];
  const valendo = custos.filter((c) => !c.vigenciaAte || c.vigenciaAte.slice(0, 10) >= hojeSP());
  const totalMes = valendo.reduce((s, c) => s + Number(c.valorMensal), 0);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Custos fixos</h2>
          <p className="text-sm text-muted-foreground">
            O que o caminhão custa todo mês, rodando ou parado.
            {valendo.length > 0 && <> Hoje: <strong>{brl(totalMes)}/mês</strong>.</>}
          </p>
        </div>
        <Permitido chave="custos-veiculo.editar">
          {!criando && (
            <Button size="sm" onClick={() => setCriando(true)}>
              Adicionar custo
            </Button>
          )}
        </Permitido>
      </div>

      {criando && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label htmlFor="cf-tipo">Qual custo</Label>
            <Select id="cf-tipo" className="w-56" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Escolha…</option>
              {TIPOS_CUSTO_FIXO.map((t) => (
                <option key={t} value={t}>
                  {TIPO_CUSTO_FIXO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-valor">Valor por mês (R$)</Label>
            <Input
              id="cf-valor"
              inputMode="decimal"
              placeholder="ex: 850,00"
              className="w-36"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-desde">Vale desde</Label>
            <Input id="cf-desde" type="date" className="w-40" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCriando(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={criar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar custo"}
            </Button>
          </div>
          {tipo === "FINANCIAMENTO" || tipo === "IPVA" || tipo === "SEGURO" ? (
            <p className="w-full text-xs text-muted-foreground">
              Pago uma vez por ano? Divida por 12 e cadastre o valor do mês.
            </p>
          ) : null}
        </div>
      )}

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!q.isLoading && custos.length === 0 && !criando && (
        <p className="text-sm text-muted-foreground">
          Nenhum custo fixo cadastrado. Sem eles, o lucro do caminhão aparece maior do que é.
        </p>
      )}

      {custos.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {custos.map((c) => {
            const encerrado = c.vigenciaAte != null && c.vigenciaAte.slice(0, 10) < hojeSP();
            return (
              <li key={c.id} className="space-y-2 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className={encerrado ? "text-muted-foreground" : undefined}>
                    <span className="font-medium">{rotulo(c.tipo)}</span>
                    <span className="ml-2 tabular-nums">{brl(c.valorMensal)}/mês</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      desde {dia(c.vigenciaDe)}
                      {c.vigenciaAte && ` até ${dia(c.vigenciaAte)}`}
                    </span>
                  </div>
                  <Permitido chave="custos-veiculo.editar">
                    <div className="flex gap-2">
                      {!c.vigenciaAte && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500 text-amber-800 hover:bg-amber-50"
                          onClick={() => setEncerrando({ id: c.id, ate: hojeSP() })}
                        >
                          Encerrar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-700 hover:bg-red-50"
                        onClick={() => setApagando(c.id)}
                      >
                        Apagar
                      </Button>
                    </div>
                  </Permitido>
                </div>

                {encerrando?.id === c.id && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md bg-amber-50 p-2 dark:bg-amber-950/30">
                    <div className="space-y-1">
                      <Label htmlFor={`cf-ate-${c.id}`}>Último dia em que valeu</Label>
                      <Input
                        id={`cf-ate-${c.id}`}
                        type="date"
                        className="w-40"
                        value={encerrando.ate}
                        onChange={(e) => setEncerrando({ id: c.id, ate: e.target.value })}
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setEncerrando(null)}>
                      Voltar
                    </Button>
                    <Button size="sm" className="bg-amber-500 text-black hover:bg-amber-600" onClick={encerrar}>
                      Encerrar custo
                    </Button>
                  </div>
                )}

                {apagando === c.id && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2 dark:bg-red-950/30">
                    <span className="text-sm">
                      Apagar some com o custo também dos meses passados. Se ele só parou de valer, use
                      Encerrar.
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setApagando(null)}>
                      Voltar
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => apagar(c.id)}>
                      Apagar de vez
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {verLucro && (
        <Link href={"/lucro" as Route} className="inline-block text-sm text-blue-700 hover:underline">
          Ver quanto este caminhão deu de lucro →
        </Link>
      )}
    </Card>
  );
}
