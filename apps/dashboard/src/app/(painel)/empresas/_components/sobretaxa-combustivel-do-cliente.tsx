"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { hojeSP } from "@/lib/datetime-br";

type Regra = {
  id: string;
  ativo: boolean;
  dieselReferencia: string;
  gatilho: string;
  percentualPorPasso: string;
  tetoPercentual: string | null;
  vigenciaDe: string;
  vigenciaAte: string | null;
};

type Form = {
  dieselReferencia: string;
  gatilho: string;
  percentualPorPasso: string;
  tetoPercentual: string;
  vigenciaDe: string;
  vigenciaAte: string;
};

/**
 * "6,00" → 6. Aceita vírgula, que é como todo mundo digita dinheiro aqui; sem
 * vírgula, o ponto é decimal ("0.10" é dez centavos, não dez reais).
 */
function numero(v: string): number | null {
  const s = v.trim();
  const t = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Número que veio da API ("6.000") de volta pro campo ("6,00"). */
function paraCampo(v: string | null, casas = 2): string {
  if (v == null) return "";
  const n = Number(v);
  const c = Math.max(casas, (String(n).split(".")[1] ?? "").length);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: 3, useGrouping: false });
}

const reais = (v: string) =>
  `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
const pct = (v: string) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
const data = (v: string) => v.slice(0, 10).split("-").reverse().join("/");

const VAZIO = (): Form => ({
  dieselReferencia: "",
  gatilho: "0,10",
  percentualPorPasso: "",
  tetoPercentual: "",
  vigenciaDe: hojeSP(),
  vigenciaAte: "",
});

/**
 * SOBRETAXA DE COMBUSTÍVEL deste cliente, na página dele, ao lado do preço —
 * é cláusula do mesmo contrato ("a cada R$ 0,10 de alta no diesel, +X% no
 * frete"). A fatura aplica sozinha quando a regra está LIGADA.
 *
 * Nasce desligada de propósito: cadastrar os números não muda fatura nenhuma;
 * ligar é um passo à parte, com o botão dizendo o que acontece.
 *
 * Mesmas chaves do preço (`tabelas-preco.*`): quem não vê preço não vê isto.
 */
export function SobretaxaCombustivelDoCliente({ clienteId }: { clienteId: string }) {
  const { temPermissao, temModulo } = usePermissoes();
  const ve = temPermissao("tabelas-preco.ver") && temModulo("tabelas-preco.ver");
  const podeCriar = temPermissao("tabelas-preco.criar");
  const podeEditar = temPermissao("tabelas-preco.editar");
  const podeApagar = temPermissao("tabelas-preco.excluir");
  const token = useAuthToken();

  const regras = useApiQuery<Regra[]>(ve ? `/admin/sobretaxa-combustivel?empresaId=${clienteId}` : undefined);
  const [editando, setEditando] = React.useState<string | "nova" | null>(null);
  const [form, setForm] = React.useState<Form>(VAZIO);
  const [erro, setErro] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [apagando, setApagando] = React.useState<string | null>(null);

  if (!ve) return null;

  function abrir(r: Regra | null) {
    setErro(null);
    if (!r) {
      setForm(VAZIO());
      setEditando("nova");
      return;
    }
    setForm({
      dieselReferencia: paraCampo(r.dieselReferencia),
      gatilho: paraCampo(r.gatilho),
      percentualPorPasso: paraCampo(r.percentualPorPasso, 0),
      tetoPercentual: paraCampo(r.tetoPercentual, 0),
      vigenciaDe: r.vigenciaDe.slice(0, 10),
      vigenciaAte: r.vigenciaAte ? r.vigenciaAte.slice(0, 10) : "",
    });
    setEditando(r.id);
  }

  async function chamar(fn: () => Promise<unknown>) {
    if (!token) return false;
    setErro(null);
    setOcupado(true);
    try {
      await fn();
      await regras.refetch();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function salvar() {
    const dieselReferencia = numero(form.dieselReferencia);
    const gatilho = numero(form.gatilho);
    const percentualPorPasso = numero(form.percentualPorPasso);
    const tetoPercentual = numero(form.tetoPercentual);
    if (!dieselReferencia || !gatilho || !percentualPorPasso) {
      setErro("Preencha o diesel de referência, o passo e o percentual por passo.");
      return;
    }
    const corpo = {
      dieselReferencia,
      gatilho,
      percentualPorPasso,
      tetoPercentual: tetoPercentual || null,
      vigenciaDe: form.vigenciaDe,
      vigenciaAte: form.vigenciaAte || null,
    };
    const ok = await chamar(() =>
      editando === "nova"
        ? fetchApi("/admin/sobretaxa-combustivel", {
            token,
            method: "POST",
            body: JSON.stringify({ ...corpo, empresaId: clienteId }),
          })
        : fetchApi(`/admin/sobretaxa-combustivel/${editando}`, {
            token,
            method: "PATCH",
            body: JSON.stringify(corpo),
          }),
    );
    if (ok) setEditando(null);
  }

  const lista = regras.data ?? [];
  const exemplo = (() => {
    const ref = numero(form.dieselReferencia);
    const g = numero(form.gatilho);
    const p = numero(form.percentualPorPasso);
    if (!ref || !g || !p) return null;
    const atual = Math.round((ref + g * 4.2) * 100) / 100;
    const passos = Math.floor(Math.round(((atual - ref) / g) * 1e6) / 1e6);
    let total = passos * p;
    const teto = numero(form.tetoPercentual);
    if (teto && total > teto) total = teto;
    return `Exemplo: diesel a ${reais(String(atual))} dá ${passos} passos = ${pct(String(total))} a mais no frete.`;
  })();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Sobretaxa de combustível</h2>
          <p className="text-sm text-muted-foreground">
            Quando o diesel sobe acima da referência, a fatura deste cliente ganha uma linha a mais: a cada
            passo de alta, um percentual sobre o frete. Diesel caindo não dá desconto.
          </p>
        </div>
        {podeCriar && editando == null && (
          <Button variant="default" size="sm" onClick={() => abrir(null)}>
            Cadastrar sobretaxa
          </Button>
        )}
      </div>

      {regras.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {regras.data && lista.length === 0 && editando == null && (
        <p className="mt-3 text-sm text-muted-foreground">
          Nenhuma sobretaxa: a fatura cobra só o frete da tabela de preço.
        </p>
      )}

      {lista.length > 0 && (
        <div className="mt-3 divide-y divide-border rounded-md border border-border">
          {lista.map((r) => (
            <div key={r.id} className="space-y-2 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Referência <strong>{reais(r.dieselReferencia)}</strong>/l · a cada{" "}
                  <strong>{reais(r.gatilho)}</strong> de alta, <strong>+{pct(r.percentualPorPasso)}</strong>
                  {r.tetoPercentual && <> · teto {pct(r.tetoPercentual)}</>}
                </span>
                {r.ativo ? (
                  <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800">Ligada</Badge>
                ) : (
                  <Badge className="border-border text-muted-foreground">Desligada</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {r.vigenciaAte ? `${data(r.vigenciaDe)} a ${data(r.vigenciaAte)}` : `desde ${data(r.vigenciaDe)}`}
                {!r.ativo && " · cadastrada, mas não entra em fatura nenhuma até ser ligada"}
              </p>
              {(podeEditar || podeApagar) && editando == null && (
                <div className="flex flex-wrap gap-2">
                  {podeEditar &&
                    (r.ativo ? (
                      <Button
                        variant="warning"
                        size="sm"
                        disabled={ocupado}
                        onClick={() =>
                          chamar(() =>
                            fetchApi(`/admin/sobretaxa-combustivel/${r.id}`, {
                              token,
                              method: "PATCH",
                              body: JSON.stringify({ ativo: false }),
                            }),
                          )
                        }
                      >
                        Desligar sobretaxa
                      </Button>
                    ) : (
                      <Button
                        variant="success"
                        size="sm"
                        disabled={ocupado}
                        onClick={() =>
                          chamar(() =>
                            fetchApi(`/admin/sobretaxa-combustivel/${r.id}`, {
                              token,
                              method: "PATCH",
                              body: JSON.stringify({ ativo: true }),
                            }),
                          )
                        }
                      >
                        Ligar nas próximas faturas
                      </Button>
                    ))}
                  {podeEditar && (
                    <Button variant="outline" size="sm" disabled={ocupado} onClick={() => abrir(r)}>
                      Editar números
                    </Button>
                  )}
                  {podeApagar &&
                    (apagando === r.id ? (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={ocupado}
                          onClick={() =>
                            chamar(() =>
                              fetchApi(`/admin/sobretaxa-combustivel/${r.id}`, { token, method: "DELETE" }),
                            ).then(() => setApagando(null))
                          }
                        >
                          Apagar de vez
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setApagando(null)}>
                          Manter
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setApagando(r.id)}>
                        Apagar
                      </Button>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editando != null && (
        <div className="mt-4 space-y-3 rounded-md border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="st-ref">Diesel de referência (R$/l)</Label>
              <Input
                id="st-ref"
                inputMode="decimal"
                placeholder="6,00"
                value={form.dieselReferencia}
                onChange={(e) => setForm({ ...form, dieselReferencia: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-gatilho">A cada alta de (R$/l)</Label>
              <Input
                id="st-gatilho"
                inputMode="decimal"
                placeholder="0,10"
                value={form.gatilho}
                onChange={(e) => setForm({ ...form, gatilho: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-pct">Soma no frete (%)</Label>
              <Input
                id="st-pct"
                inputMode="decimal"
                placeholder="1"
                value={form.percentualPorPasso}
                onChange={(e) => setForm({ ...form, percentualPorPasso: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-teto">Teto (%, opcional)</Label>
              <Input
                id="st-teto"
                inputMode="decimal"
                placeholder="sem teto"
                value={form.tetoPercentual}
                onChange={(e) => setForm({ ...form, tetoPercentual: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-de">Vale a partir de</Label>
              <Input
                id="st-de"
                type="date"
                value={form.vigenciaDe}
                onChange={(e) => setForm({ ...form, vigenciaDe: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-ate">Até (opcional)</Label>
              <Input
                id="st-ate"
                type="date"
                value={form.vigenciaAte}
                onChange={(e) => setForm({ ...form, vigenciaAte: e.target.value })}
              />
            </div>
          </div>
          {exemplo && <p className="text-sm text-muted-foreground">{exemplo}</p>}
          {editando === "nova" && (
            <p className="text-sm text-muted-foreground">
              A sobretaxa é salva desligada. Confira os números e ligue quando o cliente estiver avisado.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="success" onClick={salvar} disabled={ocupado}>
              {ocupado ? "Salvando…" : "Salvar sobretaxa"}
            </Button>
            <Button variant="outline" onClick={() => setEditando(null)} disabled={ocupado}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}
    </Card>
  );
}
