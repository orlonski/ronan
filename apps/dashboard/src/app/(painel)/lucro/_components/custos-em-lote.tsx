"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  interpretarPlanilhaCustoFixo,
  type ItemLoteCustoFixo,
  type ResultadoLoteCustoFixo,
  TIPO_CUSTO_FIXO_LABEL,
  TIPOS_CUSTO_FIXO,
  valorDoTexto,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { fmtBRL } from "@/lib/fechamento-helpers";
import { cn } from "@/lib/utils";

/**
 * Custos fixos de vários caminhões de uma vez. Dois jeitos, porque são duas
 * situações: "o seguro é o mesmo pra frota toda" (marca os caminhões) e "tenho
 * uma planilha com o IPVA de cada um" (cola as linhas).
 *
 * Sempre em dois passos — conferir, depois salvar. O servidor diz linha a linha
 * o que vai acontecer (novo, troca o valor, já estava assim, erro) e nada é
 * gravado enquanto houver erro.
 */

type Caminhao = { veiculoId: string; placa: string; modelo: string | null };
type Modo = "mesmo" | "planilha";

const ROTULO_TIPO = (t: string) => TIPO_CUSTO_FIXO_LABEL[t as keyof typeof TIPO_CUSTO_FIXO_LABEL] ?? t;
const dia = (ymd: string) => ymd.split("-").reverse().join("/");

const SITUACAO: Record<string, { texto: string; cor: string }> = {
  NOVO: { texto: "Novo", cor: "text-green-700" },
  SUBSTITUI: { texto: "Troca o valor", cor: "text-amber-700" },
  IGUAL: { texto: "Já estava assim", cor: "text-muted-foreground" },
  ERRO: { texto: "Erro", cor: "text-red-700" },
};

export function CustosEmLote({
  aberto,
  onFechar,
  caminhoes,
}: {
  aberto: boolean;
  onFechar: () => void;
  caminhoes: Caminhao[];
}) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [modo, setModo] = React.useState<Modo>("mesmo");

  // Modo "mesmo custo"
  const [tipo, setTipo] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [desde, setDesde] = React.useState(hojeSP());
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());

  // Modo "planilha"
  const [texto, setTexto] = React.useState("");
  const lida = React.useMemo(
    () => (texto.trim() ? interpretarPlanilhaCustoFixo(texto, desde) : null),
    [texto, desde],
  );

  const [conferido, setConferido] = React.useState<{
    itens: ItemLoteCustoFixo[];
    resultado: ResultadoLoteCustoFixo;
  } | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  // Qualquer mudança no que foi preenchido invalida a conferência.
  React.useEffect(() => setConferido(null), [modo, tipo, valor, desde, marcados, texto]);

  function limpar() {
    setTipo("");
    setValor("");
    setMarcados(new Set());
    setTexto("");
    setConferido(null);
  }

  function montarItens(): ItemLoteCustoFixo[] | null {
    if (modo === "mesmo") {
      if (!tipo) return toast.error("Escolha qual é o custo."), null;
      const n = valorDoTexto(valor);
      if (n == null) return toast.error("Informe quanto custa por mês."), null;
      if (marcados.size === 0) return toast.error("Marque pelo menos um caminhão."), null;
      return caminhoes
        .filter((c) => marcados.has(c.veiculoId))
        .map((c) => ({
          placa: c.placa,
          tipo: tipo as ItemLoteCustoFixo["tipo"],
          valorMensal: n,
          vigenciaDe: desde,
        }));
    }
    if (!lida || lida.itens.length === 0) {
      return toast.error("Cole as linhas da planilha."), null;
    }
    if (lida.erros.length > 0) {
      return toast.error("Corrija as linhas marcadas antes de conferir."), null;
    }
    return lida.itens.map(({ linha: _linha, ...i }) => i);
  }

  async function enviar(itens: ItemLoteCustoFixo[], simular: boolean) {
    if (!token) return;
    setEnviando(true);
    try {
      const resultado = await fetchApi<ResultadoLoteCustoFixo>("/admin/custos-veiculo/lote", {
        token,
        method: "POST",
        body: JSON.stringify({ simular, itens }),
      });
      if (simular) {
        setConferido({ itens, resultado });
        return;
      }
      if (!resultado.gravado) {
        // Mudou algo entre conferir e salvar (alguém cadastrou no meio).
        setConferido({ itens, resultado });
        toast.error("Algo mudou desde a conferência. Veja as linhas com erro.");
        return;
      }
      const n = resultado.resumo.NOVO + resultado.resumo.SUBSTITUI;
      toast.success(`${n} custo(s) salvo(s).`);
      // A chave do useApiQuery é o caminho COM a query string: casa por prefixo.
      await queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("/admin/relatorios/lucro"),
      });
      await queryClient.invalidateQueries({ queryKey: ["custos-fixos"], exact: false });
      limpar();
      onFechar();
    } catch (e) {
      toast.error("Não consegui conferir", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setEnviando(false);
    }
  }

  const todosMarcados = caminhoes.length > 0 && marcados.size === caminhoes.length;
  const r = conferido?.resultado;
  const aSalvar = r ? r.resumo.NOVO + r.resumo.SUBSTITUI : 0;

  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Cadastrar custos fixos</SheetTitle>
        </SheetHeader>

        <div className="mt-2 space-y-4 text-sm">
          <p className="text-muted-foreground">
            IPVA, seguro, parcela, salário de motorista registrado: o que o caminhão custa todo
            mês, rodando ou parado. Pago uma vez por ano? Divida por 12.
          </p>

          <div className="flex gap-1 border-b">
            {(
              [
                ["mesmo", "O mesmo custo pra vários caminhões"],
                ["planilha", "Colar de uma planilha"],
              ] as const
            ).map(([m, rotulo]) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  modo === m
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {modo === "mesmo" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="lote-tipo">Qual custo</Label>
                  <Select id="lote-tipo" className="w-56" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="">Escolha…</option>
                    {TIPOS_CUSTO_FIXO.map((t) => (
                      <option key={t} value={t}>
                        {TIPO_CUSTO_FIXO_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lote-valor">Valor por mês (R$)</Label>
                  <Input
                    id="lote-valor"
                    inputMode="decimal"
                    placeholder="ex: 850,00"
                    className="w-36"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lote-desde">Vale desde</Label>
                  <Input id="lote-desde" type="date" className="w-40" value={desde} onChange={(e) => setDesde(e.target.value)} />
                </div>
              </div>

              <div className="rounded-md border">
                <label className="flex cursor-pointer items-center gap-2 border-b bg-muted/40 px-3 py-2 font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={todosMarcados}
                    onChange={() =>
                      setMarcados(todosMarcados ? new Set() : new Set(caminhoes.map((c) => c.veiculoId)))
                    }
                  />
                  Todos os caminhões ({marcados.size} de {caminhoes.length} marcados)
                </label>
                <div className="grid max-h-72 grid-cols-1 overflow-y-auto sm:grid-cols-2">
                  {caminhoes.map((c) => (
                    <label key={c.veiculoId} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/40">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={marcados.has(c.veiculoId)}
                        onChange={() => {
                          const novo = new Set(marcados);
                          if (novo.has(c.veiculoId)) novo.delete(c.veiculoId);
                          else novo.add(c.veiculoId);
                          setMarcados(novo);
                        }}
                      />
                      <span className="font-medium">{c.placa}</span>
                      {c.modelo && <span className="text-xs text-muted-foreground">{c.modelo}</span>}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="lote-planilha">Cole aqui as linhas da planilha</Label>
                <p className="text-xs text-muted-foreground">
                  Uma linha por custo, nas colunas: <strong>placa · custo · valor por mês · vale desde</strong>.
                  Selecione as células no Excel ou no Google Planilhas, copie e cole. A data pode ficar
                  vazia — aí vale a de baixo.
                </p>
                <Textarea
                  id="lote-planilha"
                  rows={8}
                  className="font-mono text-xs"
                  placeholder={"ABC1D23\tSeguro\t900,00\t01/01/2026\nABC1D23\tIPVA\t300,00\nXYZ9876\tParcela\t4.200,00"}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lote-desde-p">Data pra linha sem data</Label>
                <Input id="lote-desde-p" type="date" className="w-40" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              {lida && lida.erros.length > 0 && (
                <ul className="space-y-1 rounded-md border-l-4 border-l-red-500 bg-red-50 p-3 dark:bg-red-950/30">
                  {lida.erros.map((e) => (
                    <li key={e.linha}>
                      <strong>Linha {e.linha}:</strong> {e.mensagem}
                    </li>
                  ))}
                </ul>
              )}
              {lida && lida.erros.length === 0 && lida.itens.length > 0 && (
                <p className="text-muted-foreground">{lida.itens.length} linha(s) lida(s).</p>
              )}
            </div>
          )}

          {r && (
            <div className="space-y-2">
              <p className="font-medium">
                {r.resumo.ERRO > 0
                  ? `${r.resumo.ERRO} linha(s) com erro — nada será salvo até corrigir.`
                  : `Tudo certo: ${aSalvar} custo(s) a salvar${r.resumo.IGUAL ? `, ${r.resumo.IGUAL} já estavam assim` : ""}.`}
              </p>
              <div className="max-h-80 overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 border-b bg-muted/60">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Caminhão</th>
                      <th className="px-2 py-1.5 text-left font-medium">Custo</th>
                      <th className="px-2 py-1.5 text-right font-medium">Por mês</th>
                      <th className="px-2 py-1.5 text-left font-medium">Desde</th>
                      <th className="px-2 py-1.5 text-left font-medium">O que acontece</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.itens.map((i, idx) => (
                      <tr key={idx} className="border-b last:border-0 align-top">
                        <td className="px-2 py-1.5 font-medium">{i.placaCadastro ?? i.placa}</td>
                        <td className="px-2 py-1.5">{ROTULO_TIPO(i.tipo)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtBRL(i.valorMensal)}</td>
                        <td className="px-2 py-1.5">{dia(i.vigenciaDe)}</td>
                        <td className={cn("px-2 py-1.5", SITUACAO[i.situacao]?.cor)}>
                          {SITUACAO[i.situacao]?.texto}
                          {i.situacao === "SUBSTITUI" && i.anterior && (
                            <span className="block text-muted-foreground">
                              o de {fmtBRL(i.anterior.valorMensal)} (desde {i.anterior.vigenciaDe}) termina na véspera
                            </span>
                          )}
                          {i.mensagem && i.situacao !== "IGUAL" && (
                            <span className="block">{i.mensagem}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onFechar} disabled={enviando}>
              Cancelar
            </Button>
            {r && r.resumo.ERRO === 0 && aSalvar > 0 ? (
              <Button
                className="bg-green-600 hover:bg-green-700"
                disabled={enviando}
                onClick={() => conferido && enviar(conferido.itens, false)}
              >
                {enviando ? "Salvando…" : `Salvar ${aSalvar} custo(s)`}
              </Button>
            ) : (
              <Button
                disabled={enviando}
                onClick={() => {
                  const itens = montarItens();
                  if (itens) void enviar(itens, true);
                }}
              >
                {enviando ? "Conferindo…" : "Conferir"}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
