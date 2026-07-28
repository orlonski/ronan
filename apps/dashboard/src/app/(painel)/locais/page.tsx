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
import { ClienteCombobox, LocalCombobox } from "@/components/fk-comboboxes";
import { toast } from "sonner";
import { useDataTableState } from "@/hooks/use-data-table-state";
import {
  fetchApi,
  useAuthToken,
  usePaginatedList,
  useUpdateResource,
} from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import type { LocalMapa } from "@/components/mapa-locais";
import type { LocalDupMapa } from "@/components/mapa-duplicata";
import { CORES as DUP_CORES } from "@/components/mapa-duplicata";

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

const MapaDuplicata = dynamic(
  () => import("@/components/mapa-duplicata").then((m) => m.MapaDuplicata),
  {
    ssr: false,
    loading: () => <div className="h-[360px] rounded-md border bg-muted/30" />,
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

type DupSimilar = {
  id: string;
  nome: string;
  totalViagens: number;
  /** Distância (m) ao local desta linha. null = fallback por nome (sem coordenada). */
  distanciaM: number | null;
  tipo: Tipo;
};
type DupEntry = {
  id: string;
  nome: string;
  totalViagens: number;
  grupoId: string;
  papel: "provavel_lixo" | "duplicata";
  similares: DupSimilar[];
  tipo: Tipo;
};

// ---- Duplicados geográficos (aba Mapa) ----
type GeoLocal = {
  id: string;
  nome: string;
  lat: number | null;
  lng: number | null;
  tipo: Tipo;
  endereco: string;
  totalViagens: number;
  latLngPrecisao: number | null;
  latLngFonte: "PRECISA" | "BALANCED" | "CACHE" | null;
  origemCadastro: Origem | null;
  nivelConfianca: string;
  motoristasDistintos: number;
  pctDescargaForaRaio: number | null;
  distanciaDoPrincipalM: number;
  flags: { offline: boolean; semEndereco: boolean; rascunho: boolean; poucasViagens: boolean };
};
type GeoGrupo = {
  id: string;
  centroide: { lat: number; lng: number };
  gravidade: number;
  principal: GeoLocal;
  candidatos: GeoLocal[];
};
type DuplicatasGeoResp = { raioM: number; raioAtualBusca: number; grupos: GeoGrupo[] };

const PATH = "/admin/locais";

const TIPO_LOCAL_COLOR: Record<Tipo, string> = {
  CARGA: "border-emerald-200 bg-emerald-50 text-emerald-900",
  DESCARGA: "border-rose-200 bg-rose-50 text-rose-900",
  AMBOS: "border-violet-200 bg-violet-50 text-violet-900",
};

function TipoBadge({ tipo }: { tipo: Tipo }) {
  return (
    <Badge className={`shrink-0 text-[10px] ${TIPO_LOCAL_COLOR[tipo] ?? ""}`}>{tipo}</Badge>
  );
}

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
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function plural(n: number, sing: string, plur: string) {
  return `${n} ${n === 1 ? sing : plur}`;
}

function DuplicataTag({ dup, onClick }: { dup: DupEntry; onClick: () => void }) {
  const lixo = dup.papel === "provavel_lixo";
  const forte = dup.similares[0];
  const descrever = (s: DupSimilar) => {
    const dist = s.distanciaM != null ? ` a ${s.distanciaM} m` : "";
    return `"${s.nome}"${dist} (${plural(s.totalViagens, "viagem", "viagens")})`;
  };
  const title = lixo
    ? `Mesmo lugar que ${forte ? descrever(forte) : "outro"}? Este tem ${plural(
        dup.totalViagens,
        "viagem",
        "viagens",
      )}. Clique pra mesclar ou conferir.`
    : `Local repetido? Perto de: ${dup.similares
        .map(descrever)
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
      {lixo ? "Provável duplicata" : "Local repetido?"}
    </button>
  );
}

export default function LocaisPage() {
  // Curadoria de cadastro (duplicatas) e filtro por cliente varrem/expõem a base
  // toda — não valem pra quem tem acesso restrito a frota.
  const { acessoGlobal } = usePermissoes();
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Local>(PATH, tableState);
  const update = useUpdateResource<Record<string, unknown>, Local>(PATH, PATH);
  const token = useAuthToken();
  const qc = useQueryClient();
  const [view, setView] = useState<"lista" | "mapa">("lista");
  const { viewMode, setViewMode } = useListViewMode("locais");
  const [mesclando, setMesclando] = useState<DupEntry | null>(null);
  // Aba Mapa: modo "duplicados suspeitos" (geográfico) + raio de agrupamento + foco.
  const [suspeitos, setSuspeitos] = useState(false);
  const [raioDedup, setRaioDedup] = useState(200);
  const [foco, setFoco] = useState<{ lat: number; lng: number; nome?: string } | null>(
    null,
  );
  // Local buscado pra destacar (id do pino aceso) + input de lat/lng cru.
  const [focoId, setFocoId] = useState<string | null>(null);
  const [coordInput, setCoordInput] = useState("");

  // Carrega só quando aba "Mapa" tá ativa. O mapa usa os MESMOS filtros da Lista
  // (mesmo tableState), então a queryKey inclui q + filtros pra refazer quando
  // mudam. QueryKey começa com PATH pra invalidate de create/update/delete pegar
  // o mapa junto (TanStack faz partial match por prefixo do array).
  const mapa = useQuery({
    queryKey: [PATH, "mapa", tableState.q, tableState.filters],
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
    queryKey: [PATH, "duplicatas"],
    // Curadoria de cadastro: varre TODOS os locais e compara nomes. Não é
    // dado da frota do usuário — some pra quem tem acesso restrito.
    enabled: view === "lista" && !!token && acessoGlobal,
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

  // Duplicados GEOGRÁFICOS: grupos de locais próximos entre si + score. Carrega
  // só na aba Mapa com o modo ligado. QueryKey inclui o raio (ajustável ao vivo).
  const geoDup = useQuery({
    queryKey: [PATH, "duplicatas-geo", raioDedup],
    enabled: view === "mapa" && suspeitos && !!token && acessoGlobal,
    queryFn: () =>
      fetchApi<DuplicatasGeoResp>(`/admin/locais/duplicatas-geo?raioM=${raioDedup}`, { token }),
    staleTime: 30_000,
  });
  const gruposMapa = useMemo(
    () =>
      (geoDup.data?.grupos ?? []).map((g, i) => ({
        id: g.id,
        numero: i + 1,
        centroide: g.centroide,
        pontos: [
          { id: g.principal.id, nome: g.principal.nome, lat: g.principal.lat, lng: g.principal.lng, papel: "principal" as const },
          ...g.candidatos.map((c) => ({ id: c.id, nome: c.nome, lat: c.lat, lng: c.lng, papel: "candidato" as const })),
        ],
      })),
    [geoDup.data],
  );

  // Busca um local pra destacar: pega o lat/lng do próprio mapa (já carregado);
  // se não estiver nele (filtrado / outra view), busca as coords do local.
  function buscarLocalFoco(id: string | undefined) {
    if (!id) {
      setFoco(null);
      setFocoId(null);
      return;
    }
    const l = mapa.data?.find((x) => x.id === id);
    if (l?.lat != null && l.lng != null) {
      setFoco({ lat: l.lat, lng: l.lng, nome: l.nome });
      setFocoId(id);
      return;
    }
    void (async () => {
      try {
        const full = await fetchApi<{ nome: string; lat: number | null; lng: number | null }>(
          `${PATH}/${id}`,
          { token },
        );
        if (full.lat != null && full.lng != null) {
          setFoco({ lat: full.lat, lng: full.lng, nome: full.nome });
          setFocoId(null); // fora dos pinos desenhados → marcador avulso
        } else {
          toast.error("Local sem GPS — não dá pra localizar no mapa.");
        }
      } catch {
        toast.error("Não deu pra localizar esse local.");
      }
    })();
  }

  function irCoord() {
    const m = coordInput.trim().match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      toast.error("Use o formato: lat, lng (ex: -25.42840, -49.27330)");
      return;
    }
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      toast.error("Coordenada fora de faixa (lat ±90, lng ±180).");
      return;
    }
    setFoco({ lat, lng, nome: `Coordenada ${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    setFocoId(null);
  }

  function limparFoco() {
    setFoco(null);
    setFocoId(null);
    setCoordInput("");
  }

  const totalGeral = list.data?.pagination.total ?? 0;
  const totalNoMapa = mapa.data?.length ?? 0;
  const semCoord = view === "mapa" && mapa.data ? Math.max(totalGeral - totalNoMapa, 0) : 0;


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
      {acessoGlobal && (
        <ClienteCombobox
          value={tableState.filters.clienteId}
          onChange={(v) => tableState.setFilter("clienteId", v)}
          placeholder="Cliente"
        />
      )}
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
          {/* Barra do modo "duplicados suspeitos" */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={suspeitos}
                onChange={(e) => {
                  setSuspeitos(e.target.checked);
                  setFoco(null);
                  setFocoId(null);
                }}
                className="h-4 w-4"
              />
              Duplicados suspeitos
            </label>
            {suspeitos && (
              <>
                <span className="text-sm text-muted-foreground">
                  agrupar locais a até
                </span>
                <input
                  type="number"
                  min={20}
                  max={5000}
                  step={20}
                  value={raioDedup}
                  onChange={(e) =>
                    setRaioDedup(Math.min(5000, Math.max(20, Number(e.target.value) || 200)))
                  }
                  className="w-20 rounded-md border px-2 py-1 text-sm"
                />
                <span className="text-sm text-muted-foreground">m um do outro</span>
                {geoDup.data && (
                  <span className="ml-auto text-sm text-muted-foreground">
                    {plural(geoDup.data.grupos.length, "caso", "casos")} · raio de busca atual{" "}
                    {geoDup.data.raioAtualBusca} m
                  </span>
                )}
              </>
            )}
          </div>
          {/* Localizar um local (busca por nome/endereço) ou lat/lng: acende o
              pino em destaque e centraliza. Só no modo normal (sem suspeitos). */}
          {!suspeitos && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <span className="text-sm font-medium">Localizar:</span>
              <div className="min-w-[220px] flex-1 sm:max-w-xs">
                <LocalCombobox
                  value={focoId ?? undefined}
                  onChange={buscarLocalFoco}
                  placeholder="Buscar local pra destacar…"
                />
              </div>
              <span className="text-xs text-muted-foreground">ou</span>
              <input
                value={coordInput}
                onChange={(e) => setCoordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && irCoord()}
                placeholder="lat, lng"
                className="w-40 rounded-md border px-2 py-1 text-sm"
              />
              <Button size="sm" variant="outline" onClick={irCoord}>
                Ir
              </Button>
              {foco && (
                <>
                  <Button size="sm" variant="ghost" onClick={limparFoco}>
                    Limpar
                  </Button>
                  {foco.nome && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 text-amber-600" />
                      Em destaque: <span className="font-medium">{foco.nome}</span>
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {suspeitos ? (
            <div className="grid gap-3 lg:grid-cols-[1fr_400px]">
              <MapaLocais
                locais={mapa.data ?? []}
                loading={mapa.isLoading}
                gruposSuspeitos={gruposMapa}
                raioSuspeitoM={raioDedup}
                foco={foco}
              />
              <PainelDuplicados
                grupos={geoDup.data?.grupos ?? []}
                loading={geoDup.isLoading}
                onFocar={(c) => setFoco(c)}
                onMesclar={(origemId, destinoId) => mesclar.mutate({ origemId, destinoId })}
                mesclando={mesclar.isPending}
              />
            </div>
          ) : (
            <MapaLocais
              locais={mapa.data ?? []}
              loading={mapa.isLoading}
              foco={foco}
              focoId={focoId}
            />
          )}
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
  const token = useAuthToken();
  const ids = useMemo(
    () => [dup.id, ...dup.similares.map((s) => s.id)],
    [dup],
  );
  // Avisa quando o grupo mistura carga e descarga (a detecção é só geográfica).
  const tiposConflitantes = useMemo(() => {
    const s = new Set<Tipo>([dup.tipo, ...dup.similares.map((x) => x.tipo)]);
    return s.has("CARGA") && s.has("DESCARGA");
  }, [dup]);
  // Mapa de conferência: pins dos locais do grupo + GPS real das descargas.
  const mapaQ = useQuery({
    queryKey: ["dup-mapa", ids.join(",")],
    enabled: !!token,
    queryFn: () =>
      fetchApi<LocalDupMapa[]>(
        `/admin/locais/duplicata-mapa?ids=${encodeURIComponent(ids.join(","))}`,
        { token },
      ),
    staleTime: 60_000,
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>Revisar duplicata &quot;{dup.nome}&quot;</span>
            <TipoBadge tipo={dup.tipo} />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Confira no mapa se é o <strong>mesmo lugar</strong>: cada cor é um local do
            grupo (pin = cadastro; bolinhas = onde as viagens realmente descarregaram).
            Se as manchas se sobrepõem, é duplicata.
          </p>
          {tiposConflitantes && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Este grupo tem <strong>carga e descarga</strong> juntos. A detecção é só
                por proximidade — confirme que é o mesmo lugar físico antes de mesclar
                (ao mesclar, o local vira o tipo do que você mantém).
              </span>
            </div>
          )}
          {mapaQ.isLoading ? (
            <div className="h-[360px] rounded-md border bg-muted/30" />
          ) : (
            <MapaDuplicata locais={mapaQ.data ?? []} />
          )}
          <p className="pt-1 text-sm text-muted-foreground">
            Ao mesclar, {dup.totalViagens === 0 ? "este local" : "as viagens dele"}{" "}
            {dup.totalViagens === 0
              ? "é apagado e some da lista"
              : "vão pro local escolhido e ele é apagado"}
            . Escolha o local correto (a manter):
          </p>
          <div className="space-y-1 rounded-md border p-1">
            {dup.similares.map((s, j) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setDestinoId(s.id)}
                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                  destinoId === s.id ? "bg-primary/10" : "hover:bg-muted"
                }`}
              >
                {/* Número/cor batem com o pin no mapa (local atual = 1). */}
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: DUP_CORES[(j + 1) % DUP_CORES.length] }}
                >
                  {j + 2}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.nome}</span>
                <TipoBadge tipo={s.tipo} />
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {s.distanciaM != null ? `a ${s.distanciaM} m · ` : ""}
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

function FlagChip({ label, tone }: { label: string; tone: "red" | "amber" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        tone === "red"
          ? "border-red-200 bg-red-100 text-red-700"
          : "border-amber-200 bg-amber-100 text-amber-700"
      }`}
    >
      {label}
    </span>
  );
}

function flagsLocal(l: GeoLocal): { label: string; tone: "red" | "amber" }[] {
  const out: { label: string; tone: "red" | "amber" }[] = [];
  if (l.flags.offline) out.push({ label: "sem sinal (cache)", tone: "red" });
  if (l.flags.semEndereco) out.push({ label: "sem endereço", tone: "red" });
  if (l.flags.rascunho) out.push({ label: "rascunho", tone: "amber" });
  if (l.pctDescargaForaRaio != null && l.pctDescargaForaRaio >= 50) {
    out.push({ label: `${l.pctDescargaForaRaio}% descargas fora do raio`, tone: "amber" });
  }
  return out;
}

/** Painel de casos ranqueados por gravidade (ao lado do mapa, modo suspeitos). */
function PainelDuplicados({
  grupos,
  loading,
  onFocar,
  onMesclar,
  mesclando,
}: {
  grupos: GeoGrupo[];
  loading: boolean;
  onFocar: (c: { lat: number; lng: number }) => void;
  onMesclar: (origemId: string, destinoId: string) => void;
  mesclando: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Analisando locais próximos entre si…
      </div>
    );
  }
  if (grupos.length === 0) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border p-6 text-center text-sm text-muted-foreground">
        Nenhum grupo suspeito nesse raio. 🎉
      </div>
    );
  }
  return (
    <div className="max-h-[calc(100vh-260px)] min-h-[500px] space-y-3 overflow-y-auto rounded-lg border p-3">
      {grupos.map((g, i) => (
        <Card key={g.id} className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              Caso {i + 1}{" "}
              <span className="font-normal text-muted-foreground">
                · {g.candidatos.length + 1} locais próximos
              </span>
            </span>
            <button
              type="button"
              onClick={() => onFocar(g.centroide)}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              Ver no mapa
            </button>
          </div>

          {/* Principal recomendado (manter) */}
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
            <div className="flex items-center gap-2">
              <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">Manter</Badge>
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                {g.principal.nome}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {g.principal.endereco || "sem endereço"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {plural(g.principal.totalViagens, "viagem", "viagens")} ·{" "}
              {plural(g.principal.motoristasDistintos, "motorista validou", "motoristas validaram")}
            </p>
          </div>

          {/* Candidatos a duplicado */}
          {g.candidatos.map((c) => (
            <div key={c.id} className="rounded-md border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{c.nome}</span>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.endereco || "sem endereço"} · {c.distanciaDoPrincipalM} m do principal
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {plural(c.totalViagens, "viagem", "viagens")}
                </span>
              </div>
              {flagsLocal(c).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {flagsLocal(c).map((f, k) => (
                    <FlagChip key={k} label={f.label} tone={f.tone} />
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3">
                <Permitido chave="locais.homologar">
                  <Button
                    type="button"
                    size="sm"
                    disabled={mesclando}
                    onClick={() => onMesclar(c.id, g.principal.id)}
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    <span className="ml-1">Mesclar no principal</span>
                  </Button>
                </Permitido>
                <Link
                  href={`/locais/${c.id}`}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Editar
                </Link>
                <button
                  type="button"
                  onClick={() =>
                    c.lat != null && c.lng != null && onFocar({ lat: c.lat, lng: c.lng })
                  }
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Focar
                </button>
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
