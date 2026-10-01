"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { BarraDeAcao } from "@/components/barra-de-acao";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";

/**
 * Gerar a fatura do cliente: as viagens com valor do período, e as estadias
 * (fila, espera com valor/hora) que a torre já calculou. A API sempre soube
 * gerar fatura — faltava a tela, e as contas a receber só nasciam por fora.
 *
 * Dois passos: conferir (nada é gravado) e gerar. As estadias vêm marcadas;
 * quem fatura desmarca o que combinou não cobrar.
 */

type Empresa = { id: string; nome: string };

type Previa = {
  viagens: number;
  valorViagens: string;
  semPreco: number;
  estadias: {
    eventoId: string;
    viagemId: string;
    tipoNome: string;
    horasCobradas: number;
    valorHora: string;
    valor: string;
    data: string | null;
    ticket: string | null;
  }[];
};

const brl = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export default function NovaFaturaPage() {
  return (
    <RequerTela chave="financeiro.faturar">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const router = useRouter();
  const token = useAuthToken();
  const empresas = useResourceOptions<Empresa>("/admin/empresas");
  const [empresaId, setEmpresaId] = React.useState("");
  const [de, setDe] = React.useState(primeiroDiaDoMesSP());
  const [ate, setAte] = React.useState(ultimoDiaDoMesSP());
  const [parcelas, setParcelas] = React.useState("1");
  const [prazo, setPrazo] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [marcadas, setMarcadas] = React.useState<Set<string>>(new Set());
  const [erro, setErro] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  // Mudou o que se fatura: a conferência anterior não vale mais.
  React.useEffect(() => setPrevia(null), [empresaId, de, ate]);

  async function conferir() {
    if (!token) return;
    if (!empresaId) return setErro("Escolha o cliente.");
    setErro(null);
    setOcupado(true);
    try {
      const p = await fetchApi<Previa>(
        `/admin/financeiro/faturas/previa?${new URLSearchParams({ empresaId, periodoInicio: de, periodoFim: ate })}`,
        { token },
      );
      setPrevia(p);
      setMarcadas(new Set(p.estadias.map((e) => e.eventoId)));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function gerar() {
    if (!token || !previa) return;
    setErro(null);
    setOcupado(true);
    try {
      await fetchApi("/admin/financeiro/faturas", {
        token,
        method: "POST",
        body: JSON.stringify({
          empresaId,
          periodoInicio: de,
          periodoFim: ate,
          parcelas: Number(parcelas) || 1,
          prazoDias: prazo.trim() ? Number(prazo) : null,
          observacao: observacao.trim() || null,
          estadias: [...marcadas],
        }),
      });
      router.push("/financeiro");
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  const valorEstadias = previa
    ? previa.estadias.filter((e) => marcadas.has(e.eventoId)).reduce((s, e) => s + Number(e.valor), 0)
    : 0;
  const total = previa ? Number(previa.valorViagens) + valorEstadias : 0;

  return (
    <div className="space-y-5">
      <FormPageHeader title="Gerar fatura" backHref="/financeiro" />

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="fat-empresa">Cliente</Label>
            <Select id="fat-empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              <option value="">Escolha…</option>
              {(empresas.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fat-de">De</Label>
            <Input id="fat-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fat-ate">Até</Label>
            <Input id="fat-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
        </div>
        {!previa && (
          <Button onClick={conferir} disabled={ocupado}>
            {ocupado ? "Conferindo…" : "Conferir o que entra"}
          </Button>
        )}
      </Card>

      {erro && <Card className="border-l-4 border-l-red-500 p-3 text-sm">{erro}</Card>}

      {previa && (
        <>
          <Card className="space-y-2 p-5 text-sm">
            <p>
              <strong>{previa.viagens}</strong> viagem(ns) com valor · <strong>{brl(previa.valorViagens)}</strong>
            </p>
            {previa.semPreco > 0 && (
              <p className="text-amber-800">
                {previa.semPreco} viagem(ns) do período estão sem preço e ficam de fora. Cadastre o preço
                do cliente e confira de novo pra incluir.
              </p>
            )}
            {previa.viagens === 0 && (
              <p className="text-red-700">Nada pra faturar nesse período (ou já foi tudo faturado).</p>
            )}
          </Card>

          {previa.estadias.length > 0 && (
            <Card className="space-y-3 p-5">
              <div>
                <h2 className="text-sm font-semibold">Estadias pra cobrar</h2>
                <p className="text-sm text-muted-foreground">
                  Paradas com valor por hora (fila, espera) já encerradas. Desmarque o que foi combinado não
                  cobrar.
                </p>
              </div>
              <ul className="divide-y rounded-md border text-sm">
                {previa.estadias.map((e) => (
                  <li key={e.eventoId}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={marcadas.has(e.eventoId)}
                        onChange={() => {
                          const n = new Set(marcadas);
                          if (n.has(e.eventoId)) n.delete(e.eventoId);
                          else n.add(e.eventoId);
                          setMarcadas(n);
                        }}
                      />
                      <span className="flex-1">
                        {dia(e.data)}
                        {e.ticket && ` · ticket ${e.ticket}`} · {e.tipoNome}
                        <span className="text-muted-foreground">
                          {" "}
                          · {e.horasCobradas}h × {brl(e.valorHora)}
                        </span>
                      </span>
                      <span className="tabular-nums">{brl(e.valor)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="fat-parcelas">Parcelas</Label>
                <Input
                  id="fat-parcelas"
                  inputMode="numeric"
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fat-prazo">Prazo em dias (opcional)</Label>
                <Input
                  id="fat-prazo"
                  inputMode="numeric"
                  placeholder="o do cadastro do cliente"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fat-obs">Observação (opcional)</Label>
                <Input id="fat-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
              </div>
            </div>
            <p className="text-base">
              Total da fatura: <strong className="tabular-nums">{brl(total)}</strong>
              {valorEstadias > 0 && (
                <span className="text-sm text-muted-foreground"> (inclui {brl(valorEstadias)} de estadia)</span>
              )}
            </p>
          </Card>

          <BarraDeAcao>
            <Button variant="outline" onClick={() => setPrevia(null)} disabled={ocupado}>
              Voltar
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={gerar}
              disabled={ocupado || previa.viagens === 0}
            >
              {ocupado ? "Gerando…" : "Gerar fatura"}
            </Button>
          </BarraDeAcao>
        </>
      )}
    </div>
  );
}
