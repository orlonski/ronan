"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Permitido } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingCard } from "@/components/loading";
import { VisualizadorFotos, type FotoVisualizavel } from "@/components/visualizador-fotos";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";

/**
 * Checklist do caminhão, do lado do escritório: o que o motorista confere
 * (o modelo), o que foi feito e quais caminhões rodaram sem.
 *
 * LEMBRADO, nunca obrigatório: o app lembra antes de iniciar a viagem; aqui só
 * se vê quem rodou sem. Item com problema já virou aviso na caixa de entrada.
 */

type ItemModelo = { id?: string; texto: string; fotoSeReprovar: boolean; abreAviso: boolean };
type Modelo = { id: string; nome: string; ativo: boolean; itens: ItemModelo[] };
type Historico = {
  checklists: {
    id: string;
    feitoEm: string;
    motorista: string;
    veiculo: { id: string; placa: string } | null;
    reprovados: number;
    respostas: { id: string; texto: string; ok: boolean; observacao: string | null; temFoto: boolean; problemaId: string | null }[];
  }[];
  semChecklist: { veiculoId: string; placa: string; dia: string; motoristas: string[] }[];
};

const dia = (ymd: string) => ymd.split("-").reverse().join("/");
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function seteDiasAtras(): string {
  const d = new Date(`${hojeSP()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

export function ChecklistCaminhao() {
  return (
    <div className="space-y-5">
      <ModeloChecklist />
      <HistoricoChecklist />
    </div>
  );
}

function ModeloChecklist() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const modelos = useQuery({
    queryKey: ["checklist-modelos"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Modelo[]>("/admin/checklists/modelos", { token: token! }),
  });
  const ativo = modelos.data?.find((m) => m.ativo) ?? null;
  const [editando, setEditando] = React.useState<{ nome: string; itens: ItemModelo[] } | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  async function criarSugerido() {
    if (!token) return;
    setSalvando(true);
    try {
      await fetchApi("/admin/checklists/modelos/sugerido", { token, method: "POST" });
      await qc.invalidateQueries({ queryKey: ["checklist-modelos"] });
      toast.success("Checklist criado. Ajuste os itens se quiser.");
    } catch (e) {
      toast.error("Não consegui criar", { description: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  async function salvar() {
    if (!token || !editando || !ativo) return;
    const itens = editando.itens.filter((i) => i.texto.trim().length > 0);
    if (itens.length === 0) return toast.error("O checklist precisa de pelo menos um item.");
    setSalvando(true);
    try {
      await fetchApi(`/admin/checklists/modelos/${ativo.id}`, {
        token,
        method: "PUT",
        body: JSON.stringify({ nome: editando.nome, ativo: true, itens }),
      });
      await qc.invalidateQueries({ queryKey: ["checklist-modelos"] });
      setEditando(null);
      toast.success("Checklist salvo. O app já mostra a versão nova.");
    } catch (e) {
      toast.error("Não consegui salvar", { description: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  if (modelos.isLoading) return <LoadingCard />;

  if (!ativo) {
    return (
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">O que o motorista confere</h2>
        <p className="text-sm text-muted-foreground">
          Monte o checklist do caminhão e o app passa a lembrar o motorista de conferir antes de sair. Item
          com problema vira aviso aqui na Manutenção. É lembrete: ninguém fica impedido de rodar.
        </p>
        <Permitido chave="checklists.editar">
          <Button onClick={criarSugerido} disabled={salvando}>
            Começar com o checklist sugerido
          </Button>
        </Permitido>
      </Card>
    );
  }

  if (editando) {
    return (
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">Editar o checklist</h2>
        <ul className="space-y-2">
          {editando.itens.map((it, i) => (
            <li key={it.id ?? `novo-${i}`} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <Input
                className="min-w-64 flex-1"
                value={it.texto}
                placeholder="Ex.: Pneus calibrados"
                onChange={(e) => {
                  const itens = [...editando.itens];
                  itens[i] = { ...it, texto: e.target.value };
                  setEditando({ ...editando, itens });
                }}
              />
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={it.fotoSeReprovar}
                  onChange={(e) => {
                    const itens = [...editando.itens];
                    itens[i] = { ...it, fotoSeReprovar: e.target.checked };
                    setEditando({ ...editando, itens });
                  }}
                />
                pede foto se tiver problema
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={it.abreAviso}
                  onChange={(e) => {
                    const itens = [...editando.itens];
                    itens[i] = { ...it, abreAviso: e.target.checked };
                    setEditando({ ...editando, itens });
                  }}
                />
                vira aviso na manutenção
              </label>
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-700 hover:bg-red-50"
                aria-label="Tirar item"
                onClick={() => setEditando({ ...editando, itens: editando.itens.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setEditando({ ...editando, itens: [...editando.itens, { texto: "", fotoSeReprovar: true, abreAviso: true }] })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar item
        </Button>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => setEditando(null)} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="bg-green-600 hover:bg-green-700" onClick={salvar} disabled={salvando}>
            Salvar checklist
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">O que o motorista confere</h2>
          <p className="text-sm text-muted-foreground">
            O app lembra antes de iniciar a viagem. Lembrete, não obrigação.
          </p>
        </div>
        <Permitido chave="checklists.editar">
          <Button variant="outline" size="sm" onClick={() => setEditando({ nome: ativo.nome, itens: ativo.itens })}>
            Editar itens
          </Button>
        </Permitido>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {ativo.itens.map((it) => (
          <li key={it.id}>
            {it.texto}
            {!it.abreAviso && <span className="text-muted-foreground"> · não vira aviso</span>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function HistoricoChecklist() {
  const token = useAuthToken();
  const [de, setDe] = React.useState(seteDiasAtras());
  const [ate, setAte] = React.useState(hojeSP());
  const [foto, setFoto] = React.useState<FotoVisualizavel[] | null>(null);
  const q = useQuery({
    queryKey: ["checklist-historico", de, ate],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Historico>(`/admin/checklists?de=${de}&ate=${ate}`, { token: token! }),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Input type="date" className="w-40" aria-label="De" value={de} onChange={(e) => setDe(e.target.value)} />
        <span className="text-sm text-muted-foreground">até</span>
        <Input type="date" className="w-40" aria-label="Até" value={ate} onChange={(e) => setAte(e.target.value)} />
      </Card>
      {q.isLoading && <LoadingCard />}
      {q.data && (
        <>
          <Card className="p-5">
            <h2 className="mb-2 text-base font-semibold">Rodaram sem checklist</h2>
            {q.data.semChecklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum caminhão rodou sem checklist no período.</p>
            ) : (
              <ul className="divide-y text-sm">
                {q.data.semChecklist.map((s) => (
                  <li key={`${s.veiculoId}-${s.dia}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span>
                      <Link href={`/veiculos/${s.veiculoId}` as Route} className="font-medium hover:underline">
                        {s.placa}
                      </Link>{" "}
                      <span className="text-muted-foreground">· {s.motoristas.join(", ")}</span>
                    </span>
                    <span className="text-muted-foreground">{dia(s.dia)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-2 text-base font-semibold">Checklists feitos</h2>
            {q.data.checklists.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum checklist no período.</p>
            ) : (
              <ul className="divide-y text-sm">
                {q.data.checklists.map((c) => (
                  <li key={c.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{c.veiculo?.placa ?? "Caminhão não informado"}</span>{" "}
                        <span className="text-muted-foreground">· {c.motorista} · {dataHora(c.feitoEm)}</span>
                      </span>
                      {c.reprovados > 0 ? (
                        <Badge className="border-amber-300 bg-amber-100 text-amber-900">
                          {c.reprovados} com problema
                        </Badge>
                      ) : (
                        <Badge className="border-green-200 bg-green-100 text-green-800">Tudo OK</Badge>
                      )}
                    </div>
                    {c.respostas
                      .filter((r) => !r.ok)
                      .map((r) => (
                        <p key={r.id} className="pl-3 text-muted-foreground">
                          ✗ {r.texto}
                          {r.observacao && ` — ${r.observacao}`}
                          {r.temFoto && (
                            <button
                              type="button"
                              className="ml-2 text-blue-700 hover:underline"
                              onClick={() =>
                                setFoto([
                                  { id: r.id, caminho: `/admin/checklists/respostas/${r.id}/foto`, rotacao: 0 },
                                ])
                              }
                            >
                              ver foto
                            </button>
                          )}
                          {r.problemaId && <span className="ml-2 text-xs">(virou aviso)</span>}
                        </p>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <VisualizadorFotos
        fotos={foto ?? []}
        indice={foto ? 0 : null}
        onIndice={() => {}}
        onFechar={() => setFoto(null)}
        titulo="Foto do checklist"
      />
    </div>
  );
}
