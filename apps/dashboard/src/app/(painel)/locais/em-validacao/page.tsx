"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, GitMerge, MapPin } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { ExcluirButton } from "@/components/excluir-button";
import { partesSP } from "@/lib/datetime-br";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import {
  fetchApi,
  useAuthToken,
  usePaginatedList,
} from "@/lib/client-api";

type NivelConfianca =
  | "RASCUNHO"
  | "PRESENCA_PONTUAL"
  | "DWELL_CONFIRMADO"
  | "RECORRENTE"
  | "HUMANO";

type LocalEmValidacao = {
  id: string;
  nome: string;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  tipo: "CARGA" | "DESCARGA" | "AMBOS";
  nivelConfianca: NivelConfianca;
  contadorValidacoes: number;
  ultimaValidacaoEm: string | null;
  criadoEm: string;
  criadoPorMotorista: { id: string; nome: string } | null;
};

type LocalCandidato = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  logradouro: string;
};

const PATH = "/admin/locais";

const NIVEL_LABEL: Record<NivelConfianca, { label: string; cls: string }> = {
  RASCUNHO: { label: "Rascunho", cls: "bg-zinc-100 text-zinc-700" },
  PRESENCA_PONTUAL: { label: "Presença GPS", cls: "bg-blue-100 text-blue-700" },
  DWELL_CONFIRMADO: { label: "Dwell ≥10min", cls: "bg-amber-100 text-amber-700" },
  RECORRENTE: { label: "Recorrente", cls: "bg-emerald-100 text-emerald-700" },
  HUMANO: { label: "Homologado", cls: "bg-emerald-200 text-emerald-800" },
};

export default function LocaisEmValidacaoPage() {
  const tableState = useDataTableState({
    defaultSort: { field: "criadoEm", order: "desc" },
    defaultFilters: { emValidacao: "true" },
  });
  const list = usePaginatedList<LocalEmValidacao>(PATH, tableState);
  const token = useAuthToken();
  const qc = useQueryClient();
  const [mesclando, setMesclando] = useState<LocalEmValidacao | null>(null);
  const { viewMode, setViewMode } = useListViewMode("locais-em-validacao");

  const homologar = useMutation({
    mutationFn: (id: string) =>
      fetchApi<unknown>(`${PATH}/${id}/homologar`, { method: "POST", token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PATH] }),
  });

  function formatarEndereco(l: LocalEmValidacao): string {
    return `${l.logradouro}${l.numero ? `, ${l.numero}` : ""}${
      l.bairro ? ` — ${l.bairro}` : ""
    }`;
  }

  const columns = useMemo<ColumnDef<LocalEmValidacao>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.nome}</div>
            <div className="text-xs text-muted-foreground">
              {formatarEndereco(row.original)} · {row.original.cidade}/{row.original.uf}
            </div>
          </div>
        ),
      },
      {
        id: "criadoPor",
        enableSorting: false,
        header: "Criado por",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.criadoPorMotorista?.nome ?? "—"}
          </span>
        ),
      },
      {
        id: "nivelConfianca",
        accessorKey: "nivelConfianca",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Evidência" />,
        cell: ({ row }) => {
          const n = NIVEL_LABEL[row.original.nivelConfianca];
          return (
            <div className="space-y-0.5">
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${n.cls}`}>
                {n.label}
              </span>
              {row.original.contadorValidacoes > 0 && (
                <div className="text-xs text-muted-foreground">
                  {row.original.contadorValidacoes} evento
                  {row.original.contadorValidacoes === 1 ? "" : "s"}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: "criadoEm",
        accessorKey: "criadoEm",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cadastrado" />,
        cell: ({ row }) => (
          <span className="text-xs">{formatBR(row.original.criadoEm)}</span>
        ),
      },
      {
        id: "acoes",
        size: 240,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => homologar.mutate(row.original.id)}
              disabled={homologar.isPending}
              title="Homologar — confirma manualmente como válido"
            >
              <Check className="h-3.5 w-3.5" />
              <span className="ml-1">Homologar</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMesclando(row.original)}
              title="Mesclar em outro local existente"
            >
              <GitMerge className="h-3.5 w-3.5" />
            </Button>
            <ExcluirButton perm="locais.excluir"
              path={PATH}
              id={row.original.id}
              nomeRecurso={`o local "${row.original.nome}"`}
            />
          </div>
        ),
      },
    ],
    [homologar],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/locais"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            title="Voltar pra lista de locais"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Locais em validação</h1>
            <p className="text-sm text-muted-foreground">
              Locais cadastrados pelos motoristas que ainda não foram validados por
              recorrência. Homologue, mescle ou apague.
            </p>
          </div>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </header>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        pagination={list.data?.pagination}
        state={tableState}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar por nome, endereço, cidade…"
            filters={
              <Combobox
                value={tableState.filters.nivelConfianca}
                onChange={(v) => tableState.setFilter("nivelConfianca", v)}
                placeholder="Evidência"
                showSearch={false}
                options={[
                  { value: "RASCUNHO", label: "Rascunho (sem GPS)" },
                  { value: "PRESENCA_PONTUAL", label: "Presença GPS" },
                  { value: "DWELL_CONFIRMADO", label: "Dwell ≥10min" },
                ]}
              />
            }
          />
        }
        emptyMessage="Nenhum local em validação. Sistema homologou tudo sozinho 👍"
        viewMode={viewMode}
        renderMobileCard={(l) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
              <span
                className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${NIVEL_LABEL[l.nivelConfianca].cls}`}
              >
                {NIVEL_LABEL[l.nivelConfianca].label}
              </span>

              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{l.nome}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate">{formatarEndereco(l)}</span>
                  <span>·</span>
                  <span>{l.cidade}/{l.uf}</span>
                  {l.criadoPorMotorista && (
                    <>
                      <span>·</span>
                      <span>por {l.criadoPorMotorista.nome}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{formatBR(l.criadoEm)}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => homologar.mutate(l.id)}
                  disabled={homologar.isPending}
                >
                  <Check className="h-3.5 w-3.5" />
                  <span className="ml-1">Homologar</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMesclando(l)}>
                  <GitMerge className="h-3.5 w-3.5" />
                  <span className="ml-1">Mesclar</span>
                </Button>
                <ExcluirButton perm="locais.excluir"
                  path={PATH}
                  id={l.id}
                  nomeRecurso={`o local "${l.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />

      {mesclando && (
        <MesclarDialog
          origem={mesclando}
          onClose={() => setMesclando(null)}
          onMesclou={() => {
            setMesclando(null);
            qc.invalidateQueries({ queryKey: [PATH] });
          }}
        />
      )}
    </div>
  );
}

function MesclarDialog({
  origem,
  onClose,
  onMesclou,
}: {
  origem: { id: string; nome: string };
  onClose: () => void;
  onMesclou: () => void;
}) {
  const token = useAuthToken();
  const [busca, setBusca] = useState("");
  const [candidatos, setCandidatos] = useState<LocalCandidato[]>([]);
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const mesclar = useMutation({
    mutationFn: () =>
      fetchApi<{ ok: true }>(`${PATH}/${origem.id}/mesclar`, {
        method: "POST",
        body: JSON.stringify({ destinoId }),
        token,
      }),
    onSuccess: onMesclou,
  });

  async function buscar() {
    if (busca.trim().length < 2 || !token) return;
    setCarregando(true);
    try {
      const res = await fetchApi<{ data: LocalCandidato[] }>(
        `${PATH}?q=${encodeURIComponent(busca)}&pageSize=10`,
        { token },
      );
      // Filtra o próprio local da lista
      setCandidatos(res.data.filter((l) => l.id !== origem.id));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Mesclar &quot;{origem.nome}&quot;</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Escolha o local de destino. Todas as viagens vinculadas a &quot;{origem.nome}
            &quot; serão movidas pro destino, e este local será apagado.
          </p>
          <div className="space-y-2">
            <Label>Buscar local destino</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Nome, endereço ou cidade…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void buscar();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={() => void buscar()}>
                Buscar
              </Button>
            </div>
          </div>
          {carregando && (
            <p className="text-sm text-muted-foreground">Buscando…</p>
          )}
          {candidatos.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
              {candidatos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setDestinoId(c.id)}
                  className={`block w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                    destinoId === c.id ? "bg-primary/10" : "hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">{c.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.logradouro} · {c.cidade}/{c.uf}
                  </div>
                </button>
              ))}
            </div>
          )}
          {destinoId && (
            <p className="text-xs text-emerald-700">Destino selecionado.</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!destinoId || mesclar.isPending}
            onClick={() => mesclar.mutate()}
          >
            Mesclar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const t = partesSP(d);
  return `${t.dia}/${t.mes}/${t.ano}`;
}
