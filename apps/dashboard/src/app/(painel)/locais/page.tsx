"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  Eye,
  GitMerge,
  MapPin,
  Pencil,
  Plus,
  Truck,
  User,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { useDataTableState } from "@/hooks/use-data-table-state";
import {
  fetchApi,
  useAuthToken,
  usePaginatedList,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";
import type { LocalMapa } from "@/components/mapa-locais";

// Leaflet quebra em SSR (acessa window). Import dinâmico igual PontoMap.
const MapaLocais = dynamic(
  () => import("@/components/mapa-locais").then((m) => m.MapaLocais),
  {
    ssr: false,
    loading: () => (
      <div className="h-[calc(100vh-260px)] min-h-[500px] rounded-lg border bg-muted/30" />
    ),
  },
);

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";
type Origem =
  | "MOTORISTA_FORMULARIO"
  | "MOTORISTA_RAPIDO"
  | "VIAGEM_OFFLINE"
  | "ADMIN_MANUAL"
  | "ADMIN_AUDITORIA";
type Cliente = { id: string; nome: string };
type Local = {
  id: string; nome: string; logradouro: string; numero: string | null; bairro: string | null;
  cidade: string; uf: string; cep: string | null; pontoReferencia: string | null;
  tipo: Tipo; ativo: boolean; clientes: Cliente[];
  origemCadastro: Origem | null;
  totalViagens: number;
  criadoEm: string;
  criadoPor: { id: string; nome: string } | null;
  criadoPorMotorista: { id: string; nome: string } | null;
};

type DupSimilar = { id: string; nome: string; totalViagens: number };
type DupEntry = {
  id: string;
  nome: string;
  totalViagens: number;
  grupoId: string;
  papel: "provavel_lixo" | "duplicata";
  similares: DupSimilar[];
};

const PATH = "/admin/locais";
const CLIENTES_PATH = "/admin/clientes";

const TIPO_LOCAL_COLOR: Record<Tipo, string> = {
  CARGA: "border-emerald-200 bg-emerald-50 text-emerald-900",
  DESCARGA: "border-rose-200 bg-rose-50 text-rose-900",
  AMBOS: "border-violet-200 bg-violet-50 text-violet-900",
};

// Rótulos curtos pra cada fluxo de cadastro. Registros antigos (pré-rastreio)
// vêm com origemCadastro=null → exibe "—".
const ORIGEM_LABEL: Record<Origem, string> = {
  MOTORISTA_FORMULARIO: "Motorista",
  MOTORISTA_RAPIDO: "Motorista (rápido)",
  VIAGEM_OFFLINE: "Viagem offline",
  ADMIN_MANUAL: "Admin",
  ADMIN_AUDITORIA: "Admin (auditoria)",
};

function nomeCriador(l: Local): string {
  return l.criadoPor?.nome ?? l.criadoPorMotorista?.nome ?? "—";
}

// dd/mm/aaaa a partir do ISO de criadoEm.
function fmtDataCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function plural(n: number, sing: string, plur: string) {
  return `${n} ${n === 1 ? sing : plur}`;
}

function DuplicataTag({ dup, onClick }: { dup: DupEntry; onClick: () => void }) {
  const lixo = dup.papel === "provavel_lixo";
  const forte = dup.similares[0];
  const title = lixo
    ? `Parece "${forte?.nome}" (${plural(forte?.totalViagens ?? 0, "viagem", "viagens")}). Este tem ${dup.totalViagens}. Clique pra mesclar ou conferir.`
    : `Nome parecido com: ${dup.similares
        .map((s) => `${s.nome} (${plural(s.totalViagens, "viagem", "viagens")})`)
        .join(", ")}. Clique pra revisar.`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
        lixo
          ? "border-red-200 bg-red-100 text-red-700 hover:bg-red-200"
          : "border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-200"
      }`}
    >
      <AlertTriangle className="h-3 w-3" />
      {lixo ? "Provável duplicata" : "Nome parecido"}
    </button>
  );
}

export default function LocaisPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Local>(PATH, tableState);
  const clientes = useResourceOptions<Cliente>(CLIENTES_PATH);
  const update = useUpdateResource<Record<string, unknown>, Local>(PATH, PATH);
  const token = useAuthToken();
  const qc = useQueryClient();
  const [view, setView] = useState<"lista" | "mapa">("lista");
  const { viewMode, setViewMode } = useListViewMode("locais");
  const [mesclando, setMesclando] = useState<DupEntry | null>(null);

  // Carrega só quando aba "Mapa" tá ativa. O mapa usa os MESMOS filtros da Lista
  // (mesmo tableState), então a queryKey inclui q + filtros pra refazer quando
  // mudam. QueryKey começa com PATH pra invalidate de create/update/delete pegar
  // o mapa junto (TanStack faz partial match por prefixo do array).
  const mapa = useQuery({
    queryKey: [PATH, "mapa", tableState.q, tableState.filters, token],
    enabled: view === "mapa" && !!token,
    queryFn: () => {
      const usp = new URLSearchParams();
      if (tableState.q) usp.set("q", tableState.q);
      for (const [k, v] of Object.entries(tableState.filters)) {
        if (v != null && v !== "") usp.set(k, v);
      }
      const qs = usp.toString();
      return fetchApi<LocalMapa[]>(`/admin/locais/mapa${qs ? `?${qs}` : ""}`, { token });
    },
    staleTime: 60_000,
  });

  // Grupos de locais com nome parecido (provável duplicata). Carrega na aba Lista.
  // Mesmo prefixo [PATH] → invalidate de create/update/delete/mescla revalida junto.
  const duplicatas = useQuery({
    queryKey: [PATH, "duplicatas", token],
    enabled: view === "lista" && !!token,
    queryFn: () => fetchApi<DupEntry[]>("/admin/locais/duplicatas", { token }),
    staleTime: 60_000,
  });
  const dupMap = useMemo(() => {
    const m = new Map<string, DupEntry>();
    for (const d of duplicatas.data ?? []) m.set(d.id, d);
    return m;
  }, [duplicatas.data]);
  const totalLixo = useMemo(
    () => (duplicatas.data ?? []).filter((d) => d.papel === "provavel_lixo").length,
    [duplicatas.data],
  );

  const mesclar = useMutation({
    mutationFn: ({ origemId, destinoId }: { origemId: string; destinoId: string }) =>
      fetchApi<{ ok: true }>(`${PATH}/${origemId}/mesclar`, {
        method: "POST",
        body: JSON.stringify({ destinoId }),
        token,
      }),
    onSuccess: () => {
      setMesclando(null);
      qc.invalidateQueries({ queryKey: [PATH] });
    },
  });

  const totalGeral = list.data?.pagination.total ?? 0;
  const totalNoMapa = mapa.data?.length ?? 0;
  const semCoord = view === "mapa" && mapa.data ? Math.max(totalGeral - totalNoMapa, 0) : 0;

  const clienteOptions = useMemo(
    () => (clientes.data ?? []).map((o) => ({ value: o.id, label: o.nome })),
    [clientes.data],
  );

  const columns = useMemo<ColumnDef<Local>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => {
          const dup = dupMap.get(row.original.id);
          return (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.original.nome}</span>
              {dup && <DuplicataTag dup={dup} onClick={() => setMesclando(dup)} />}
            </div>
          );
        },
      },
      {
        id: "endereco",
        enableSorting: false,
        header: "Endereço",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.logradouro}
            {row.original.numero ? `, ${row.original.numero}` : ""}
            {row.original.bairro ? ` — ${row.original.bairro}` : ""}
          </span>
        ),
      },
      {
        id: "cidade",
        accessorKey: "cidade",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cidade/UF" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.cidade}/{row.original.uf}
          </span>
        ),
      },
      {
        id: "cliente",
        enableSorting: false,
        header: "Cliente",
        cell: ({ row }) => {
          const cs = row.original.clientes;
          const primeiro = cs[0];
          if (!primeiro) return "—";
          if (cs.length === 1) return primeiro.nome;
          return (
            <span title={cs.map((c) => c.nome).join(", ")}>
              {primeiro.nome}{" "}
              <span className="text-muted-foreground">+{cs.length - 1}</span>
            </span>
          );
        },
      },
      {
        id: "tipo",
        accessorKey: "tipo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      },
      {
        id: "viagens",
        enableSorting: false,
        header: () => <span className="block text-center">Viagens</span>,
        cell: ({ row }) => (
          <span
            className={`block text-center text-sm tabular-nums ${
              row.original.totalViagens === 0
                ? "text-amber-600"
                : "text-muted-foreground"
            }`}
            title={
              row.original.totalViagens === 0
                ? "Nenhuma viagem usou este local"
                : undefined
            }
          >
            {row.original.totalViagens}
          </span>
        ),
      },
      {
        id: "origem",
        enableSorting: false,
        header: "Origem",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.origemCadastro
              ? ORIGEM_LABEL[row.original.origemCadastro]
              : "—"}
          </span>
        ),
      },
      {
        id: "criadoPor",
        enableSorting: false,
        header: "Criado por",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{nomeCriador(row.original)}</span>
        ),
      },
      {
        id: "criadoEm",
        accessorKey: "criadoEm",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Criado em" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {fmtDataCurta(row.original.criadoEm)}
          </span>
        ),
      },
      {
        id: "acoes",
        size: 180,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-2">
            <Permitido chave="locais.editar">
              <StatusToggle
                active={row.original.ativo}
                onChange={(next) =>
                  update.mutate({ id: row.original.id, body: { ativo: next } })
                }
                size="sm"
              />
            </Permitido>
            <Link href={`/locais/${row.original.id}/ver`}>
              <Button variant="ghost" size="icon" title="Visualizar">
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
            <Permitido chave="locais.editar">
              <Link href={`/locais/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            <ExcluirButton perm="locais.excluir"
              path="/admin/locais"
              id={row.original.id}
              nomeRecurso={`o local "${row.original.nome}"`}
            />
          </div>
        ),
      },
    ],
    [update, dupMap],
  );

  // Filtros + busca compartilhados pelas duas abas (mesmo tableState). A toolbar
  // do DataTable é standalone, então reaproveitamos ela acima do mapa também.
  const filtros = (
    <>
      <Combobox
        value={tableState.filters.tipo}
        onChange={(v) => tableState.setFilter("tipo", v)}
        placeholder="Tipo"
        showSearch={false}
        options={[
          { value: "AMBOS", label: "Ambos" },
          { value: "CARGA", label: "Carga" },
          { value: "DESCARGA", label: "Descarga" },
        ]}
      />
      <Combobox
        value={tableState.filters.clienteId}
        onChange={(v) => tableState.setFilter("clienteId", v)}
        placeholder="Cliente"
        options={clienteOptions}
      />
      <Combobox
        value={tableState.filters.ativo}
        onChange={(v) => tableState.setFilter("ativo", v)}
        placeholder="Status"
        showSearch={false}
        options={[
          { value: "true", label: "Ativos" },
          { value: "false", label: "Inativos" },
        ]}
      />
    </>
  );
  const toolbar = (
    <DataTableToolbar
      state={tableState}
      searchPlaceholder="Buscar por nome, endereço, bairro, cidade…"
      filters={filtros}
    />
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Locais</h1>
          <p className="text-sm text-muted-foreground">
            Locais de carga e descarga. Busque por nome, endereço ou ponto de interesse.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === "lista" && <ViewModeToggle value={viewMode} onChange={setViewMode} />}
          <Link href="/locais/em-validacao">
            <Button variant="outline">
              <AlertCircle className="h-4 w-4" /> Em validação
            </Button>
          </Link>
          <Permitido chave="locais.criar">
            <Link href="/locais/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo local
              </Button>
            </Link>
          </Permitido>
        </div>
      </header>

      <div className="flex gap-1 border-b">
        {(["lista", "mapa"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`border-b-2 px-4 py-2 text-sm transition-colors ${
              view === v
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "lista" ? "Lista" : "Mapa"}
          </button>
        ))}
      </div>

      {view === "lista" && totalLixo > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {plural(totalLixo, "local parece", "locais parecem")} cadastro
            duplicado (nome quase igual a outro com mais viagens). Veja as tarjas
            vermelhas na lista — clique pra mesclar ou conferir.
          </span>
        </div>
      )}

      {view === "mapa" && semCoord > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {semCoord} local{semCoord === 1 ? "" : "is"} sem coordenada não
            aparece{semCoord === 1 ? "" : "m"} no mapa. Edite pra preencher
            endereço completo.
          </span>
        </div>
      )}

      {view === "mapa" ? (
        <div className="space-y-3">
          {toolbar}
          <MapaLocais locais={mapa.data ?? []} loading={mapa.isLoading} />
        </div>
      ) : (
      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        pagination={list.data?.pagination}
        state={tableState}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        toolbar={toolbar}
        emptyMessage="Nenhum local cadastrado."
        viewMode={viewMode}
        renderMobileCard={(l) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
              <Badge className={TIPO_LOCAL_COLOR[l.tipo] ?? ""}>{l.tipo}</Badge>

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{l.nome}</span>
                  {dupMap.get(l.id) && (
                    <DuplicataTag
                      dup={dupMap.get(l.id) as DupEntry}
                      onClick={() => setMesclando(dupMap.get(l.id) as DupEntry)}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate">
                    {l.logradouro}
                    {l.numero ? `, ${l.numero}` : ""}
                    {l.bairro ? ` — ${l.bairro}` : ""}
                  </span>
                  <span>·</span>
                  <span>{l.cidade}/{l.uf}</span>
                  {l.clientes[0] && (
                    <>
                      <span>·</span>
                      <span title={l.clientes.map((c) => c.nome).join(", ")}>
                        {l.clientes[0].nome}
                        {l.clientes.length > 1 && (
                          <span className="ml-1 opacity-70">
                            +{l.clientes.length - 1}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span
                    className={`flex items-center gap-1 ${
                      l.totalViagens === 0 ? "text-amber-600" : ""
                    }`}
                    title={
                      l.totalViagens === 0
                        ? "Nenhuma viagem usou este local"
                        : undefined
                    }
                  >
                    <Truck className="h-3.5 w-3.5 shrink-0" />
                    {l.totalViagens} viage{l.totalViagens === 1 ? "m" : "ns"}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    {nomeCriador(l)}
                  </span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    {fmtDataCurta(l.criadoEm)}
                  </span>
                  {l.origemCadastro && (
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      {ORIGEM_LABEL[l.origemCadastro]}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-1 text-muted-foreground">
                <Permitido chave="locais.editar">
                  <StatusToggle
                    active={l.ativo}
                    onChange={(next) =>
                      update.mutate({ id: l.id, body: { ativo: next } })
                    }
                    size="sm"
                  />
                </Permitido>
                <Link href={`/locais/${l.id}/ver`}>
                  <Button variant="ghost" size="icon" title="Visualizar">
                    <Eye className="h-4 w-4" />
                  </Button>
                </Link>
                <Permitido chave="locais.editar">
                  <Link href={`/locais/${l.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </Permitido>
                <ExcluirButton perm="locais.excluir"
                  path="/admin/locais"
                  id={l.id}
                  nomeRecurso={`o local "${l.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
      )}

      {mesclando && (
        <MesclarDupDialog
          dup={mesclando}
          pending={mesclar.isPending}
          onClose={() => setMesclando(null)}
          onConfirm={(destinoId) =>
            mesclar.mutate({ origemId: mesclando.id, destinoId })
          }
        />
      )}
    </div>
  );
}

function MesclarDupDialog({
  dup,
  pending,
  onClose,
  onConfirm,
}: {
  dup: DupEntry;
  pending: boolean;
  onClose: () => void;
  onConfirm: (destinoId: string) => void;
}) {
  // Default: mesclar no irmão com mais viagens (o "forte"). Admin pode trocar.
  const [destinoId, setDestinoId] = useState<string>(dup.similares[0]?.id ?? "");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mesclar &quot;{dup.nome}&quot;</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            &quot;{dup.nome}&quot; tem {plural(dup.totalViagens, "viagem", "viagens")} e
            parece duplicata. Ao mesclar, {dup.totalViagens === 0 ? "ele" : "as viagens dele"} {dup.totalViagens === 0 ? "é apagado e some da lista" : "vão pro local escolhido e ele é apagado"}.
            Escolha o local correto:
          </p>
          <div className="space-y-1 rounded-md border p-1">
            {dup.similares.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setDestinoId(s.id)}
                className={`block w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                  destinoId === s.id ? "bg-primary/10" : "hover:bg-muted"
                }`}
              >
                <span className="font-medium">{s.nome}</span>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {plural(s.totalViagens, "viagem", "viagens")}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Se preferir só apagar este local, feche aqui e use a lixeira na linha
            (disponível quando não há viagens).
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Permitido chave="locais.homologar">
            <Button
              type="button"
              disabled={!destinoId || pending}
              onClick={() => destinoId && onConfirm(destinoId)}
            >
              <GitMerge className="h-4 w-4" />
              <span className="ml-1">Mesclar</span>
            </Button>
          </Permitido>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
