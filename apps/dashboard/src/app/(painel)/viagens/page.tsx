"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Camera,
  ChevronRight,
  Clock,
  ExternalLink,
  Package,
  Route,
  Ticket,
  Truck,
  User,
  Weight,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableSortSelect,
  DataTableToolbar,
  ToolbarFilterDateRange,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ClienteCombobox, MotoristaCombobox } from "@/components/fk-comboboxes";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { firstDayOfMonth, useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePermissoes } from "@/lib/permissoes";
import { usePaginatedList } from "@/lib/client-api";
import { fmtBR, fmtDataHoraBR } from "@/lib/fechamento-helpers";
import { ValorComMinimo } from "@/components/valor-com-minimo";
import { InfoIcone } from "@/components/info-icone";
import { STATUS_VIAGEM_COLOR, STATUS_VIAGEM_LABEL } from "@/lib/status-viagem";
import { fmtPeriodoSP } from "@/lib/datetime-br";
import { formatarDuracao } from "@ronan/shared-types";

type Viagem = {
  id: string;
  data: string;
  toneladas: string;
  /** Modo de serviço. null = frete por tonelada (histórico e app antigo). */
  tipoServico: { id: string; nome: string; medicao: "PESO" | "PERIODO" } | null;
  /** Só em serviço medido por período (diária). */
  entradaEm: string | null;
  saidaEm: string | null;
  duracaoMinutos: number | null;
  ticket: string | null;
  km: string;
  status: string;
  /** true = veio do fluxo guiado "Iniciar viagem" (lifecycle). */
  iniciadaGuiada: boolean;
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  kmInformado: string;
  kmEfetivo: string;
  kmAjustada: boolean;
  ocrCampos: string[];
  veiculo: { id: string; placa: string };
  motorista: { id: string; nome: string };
  // Omitidos pelo backend pra quem não tem `viagens.ver-comercial`.
  cliente?: { id: string; nome: string } | null;
  // Nulos quando o modo de serviço não os exige (diária à disposição).
  material: { id: string; nome: string; exigeTicket: boolean } | null;
  localCarga: { id: string; nome: string; cidade: string; uf: string };
  localDescarga: { id: string; nome: string; cidade: string; uf: string } | null;
  fotos: { id: string; storageKey: string }[];
  /** true quando rota passa por pedágio cadastrado mas motorista não pôs valor. */
  temPedagioSemValor: boolean;
  /** true = km fora do padrão do trajeto (badge "Km atípico"). null = não avaliado. */
  kmForaDoPadrao: boolean | null;
  /** Preenchido quando a viagem foi criada com o app offline (momento real da criação no device). */
  criadoOfflineEm: string | null;
  /** Quando o registro chegou/sincronizou no backend — fallback de criadoOfflineEm. */
  sincronizadoEm: string;
};

/** Serviço medido por período (diária) — troca peso por entrada/saída na tela. */
function ehPeriodo(v: Viagem): boolean {
  return v.tipoServico?.medicao === "PERIODO";
}

/** Instante em que a viagem foi criada: offline (device) tem prioridade sobre a sincronização. */
function criadoEm(v: Viagem): string {
  return fmtDataHoraBR(v.criadoOfflineEm ?? v.sincronizadoEm);
}

/** Badges de alerta de uma viagem (pedágio sem valor, km atípico). Usado na
 *  coluna "Alertas" da tabela e no card do modo grade — um lugar só pra não
 *  duplicar/defasar entre os dois. */
function AlertasBadges({ v }: { v: Viagem }) {
  const badges: ReactNode[] = [];
  if (v.temPedagioSemValor) {
    badges.push(
      <Badge
        key="pedagio"
        className="gap-1 border-orange-200 bg-orange-100 text-orange-900"
        title="Rota passa por pedágio cadastrado mas valor não foi preenchido"
      >
        <AlertTriangle className="h-3 w-3" /> Pedágio?
      </Badge>,
    );
  }
  if (v.kmForaDoPadrao === true) {
    badges.push(
      <Badge
        key="km"
        className="gap-1 border-amber-300 bg-amber-100 text-amber-800"
        title="Km fora do padrão das outras viagens deste trajeto"
      >
        <AlertTriangle className="h-3 w-3" /> Km atípico
      </Badge>,
    );
  }
  return <>{badges}</>;
}


export default function ViagensPage() {
  const tableState = useDataTableState({
    defaultSort: { field: "criadaEm", order: "desc" },
    defaultFilters: { de: firstDayOfMonth() },
  });
  const list = usePaginatedList<Viagem>("/admin/viagens", tableState);
  const { viewMode, setViewMode } = useListViewMode("viagens");
  // Cliente/empresa e valores faturados só aparecem com `viagens.ver-comercial`
  // — o backend já omite do payload, isto só evita coluna e filtro vazios.
  const { temPermissao } = usePermissoes();
  const verComercial = temPermissao("viagens.ver-comercial");

  const columns = useMemo<ColumnDef<Viagem>[]>(
    () => [
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <Badge className={STATUS_VIAGEM_COLOR[row.original.status] ?? ""}>
              {STATUS_VIAGEM_LABEL[row.original.status] ?? row.original.status}
            </Badge>
            {row.original.iniciadaGuiada && (
              <Badge
                className="border-indigo-200 bg-indigo-100 text-indigo-800"
                title="Lançada pelo fluxo guiado 'Iniciar viagem'"
              >
                Guiada
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "alertas",
        enableSorting: false,
        header: () => <span>Alertas</span>,
        cell: ({ row }) => {
          const temAlerta =
            row.original.temPedagioSemValor || row.original.kmForaDoPadrao === true;
          return temAlerta ? (
            <div className="flex flex-wrap items-center gap-1">
              <AlertasBadges v={row.original} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        // Data DA VIAGEM: é a que fecha com a empresa.
        // Não confundir com "Criada em" (quando o lançamento entrou no sistema,
        // ordenação padrão da lista).
        id: "data",
        accessorKey: "data",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Data" />,
        cell: ({ row }) => <span className="text-sm tabular-nums">{fmtBR(row.original.data)}</span>,
      },
      {
        // accessorKey só pra habilitar sort no react-table (getCanSort exige
        // accessorFn) — a célula ignora e usa criadoEm() pra exibir.
        id: "criadaEm",
        accessorKey: "sincronizadoEm",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Criada em" className="text-xs" />
        ),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {criadoEm(row.original)}
          </span>
        ),
      },
      {
        id: "placa",
        accessorKey: "veiculo.placa",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Placa" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.veiculo.placa}</span>
        ),
      },
      {
        id: "motorista",
        accessorKey: "motorista.nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Motorista" />,
        cell: ({ row }) => <span className="text-sm">{row.original.motorista.nome}</span>,
      },
      {
        id: "cliente",
        accessorKey: "cliente.nome",
        enableSorting: false,
        header: verComercial ? "Material / Cliente" : "Material",
        cell: ({ row }) => (
          <div className="text-sm">
            <div className="flex items-center gap-1.5">
              {row.original.material ? (
                <span className="font-medium">{row.original.material.nome}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {ehPeriodo(row.original) && (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                  {row.original.tipoServico?.nome ?? "Diária"}
                </span>
              )}
            </div>
            {row.original.cliente && (
              <div className="text-xs text-muted-foreground">{row.original.cliente.nome}</div>
            )}
          </div>
        ),
      },
      {
        id: "trajeto",
        enableSorting: false,
        header: "Trajeto",
        cell: ({ row }) => (
          <div className="text-xs">
            <div className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3 text-muted-foreground" />
              {row.original.localCarga.nome.length > 28
                ? row.original.localCarga.nome.slice(0, 25) + "..."
                : row.original.localCarga.nome}
            </div>
            {row.original.localDescarga && (
              <div className="flex items-center gap-1">
                <ArrowDown className="h-3 w-3 text-muted-foreground" />
                {row.original.localDescarga.nome.length > 28
                  ? row.original.localDescarga.nome.slice(0, 25) + "..."
                  : row.original.localDescarga.nome}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "toneladas",
        accessorKey: "toneladas",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Toneladas" />,
        // Serviço medido por período não tem peso — mostrar "0,000 t" faria
        // parecer viagem com problema, e ainda insinuaria que soma no total.
        cell: ({ row }) =>
          ehPeriodo(row.original) ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <ValorComMinimo
              className="text-sm"
              efetivo={row.original.toneladasEfetiva}
              real={row.original.toneladasInformada}
              ajustada={row.original.toneladasAjustada}
              unidade="t"
              casas={3}
            />
          ),
      },
      {
        id: "permanencia",
        enableSorting: false,
        header: "Permanência",
        cell: ({ row }) => {
          const v = row.original;
          if (!ehPeriodo(v)) return <span className="text-sm text-muted-foreground">—</span>;
          return (
            <div className="text-xs">
              <div className="tabular-nums">{fmtPeriodoSP(v.entradaEm, v.saidaEm)}</div>
              <div className="font-medium text-violet-700">
                {v.saidaEm ? formatarDuracao(v.duracaoMinutos) : "em aberto"}
              </div>
            </div>
          );
        },
      },
      {
        id: "ticket",
        accessorKey: "ticket",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ticket" />,
        cell: ({ row }) =>
          row.original.ticket ? (
            <span className="font-mono text-sm">
              {row.original.ticket}
              {row.original.ocrCampos && row.original.ocrCampos.length > 0 && (
                <span
                  className="ml-1 text-xs text-indigo-600"
                  title={`Campos pela IA: ${row.original.ocrCampos.join(", ")}`}
                >
                  ✨
                </span>
              )}
            </span>
          ) : row.original.material?.exigeTicket ?? false ? (
            <span className="text-xs italic text-muted-foreground">sem ticket</span>
          ) : (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
              title={
                row.original.material
                  ? `${row.original.material.nome} não exige ticket`
                  : "Esse serviço não exige ticket"
              }
            >
              não exige
            </span>
          ),
      },
      {
        id: "km",
        accessorKey: "km",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Km" />,
        cell: ({ row }) => (
          <ValorComMinimo
            className="text-sm"
            efetivo={row.original.kmEfetivo}
            real={row.original.kmInformado}
            ajustada={row.original.kmAjustada}
            unidade="km"
            casas={2}
          />
        ),
      },
      {
        id: "acoes",
        size: 90,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            {row.original.fotos.length > 0 && (
              <Camera className="h-4 w-4 text-muted-foreground" />
            )}
            <Link href={`/viagens/${row.original.id}`}>
              <span className="rounded p-1 hover:bg-muted">
                <ExternalLink className="h-4 w-4" />
              </span>
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Viagens</h1>
          <p className="text-sm text-muted-foreground">
            Lançamentos dos motoristas, com status visual de conferência.
          </p>
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
            searchPlaceholder={
              verComercial
                ? "Buscar por ticket, motorista, placa, cliente…"
                : "Buscar por ticket, motorista, placa…"
            }
            filters={
              <>
                <Combobox
                  value={tableState.filters.status}
                  onChange={(v) => tableState.setFilter("status", v)}
                  placeholder="Status"
                  showSearch={false}
                  options={[
                    { value: "ENVIADA", label: "Aguardando" },
                    { value: "EM_CONFERENCIA", label: "Em conferência" },
                    { value: "OK", label: "OK" },
                    { value: "DIVERGENTE", label: "Divergente" },
                    { value: "AJUSTADA", label: "Ajustada" },
                    { value: "AGUARDANDO_PESO", label: "Aguardando peso" },
                    { value: "AGUARDANDO_SAIDA", label: "Diária aberta" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.origem}
                  onChange={(v) => tableState.setFilter("origem", v)}
                  placeholder="Origem"
                  showSearch={false}
                  options={[
                    { value: "guiada", label: "Guiada" },
                    { value: "direta", label: "Direta" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.kmForaDoPadrao}
                  onChange={(v) => tableState.setFilter("kmForaDoPadrao", v)}
                  placeholder="Km"
                  showSearch={false}
                  options={[{ value: "true", label: "Só km atípico" }]}
                />
                <MotoristaCombobox
                  value={tableState.filters.motoristaId}
                  onChange={(v) => tableState.setFilter("motoristaId", v)}
                  placeholder="Motorista"
                />
                {verComercial && (
                  <ClienteCombobox
                    value={tableState.filters.clienteId}
                    onChange={(v) => tableState.setFilter("clienteId", v)}
                    placeholder="Cliente"
                  />
                )}
                <ToolbarFilterDateRange state={tableState} label="Período" />
                {viewMode === "cards" && (
                  <DataTableSortSelect
                    state={tableState}
                    options={[
                      { value: "criadaEm", label: "Criada em" },
                      { value: "data", label: "Data" },
                      { value: "status", label: "Status" },
                      { value: "motorista", label: "Motorista" },
                      { value: "placa", label: "Placa" },
                      ...(verComercial ? [{ value: "cliente", label: "Cliente" }] : []),
                      { value: "toneladas", label: "Toneladas" },
                      { value: "km", label: "Km" },
                      { value: "ticket", label: "Ticket" },
                    ]}
                  />
                )}
              </>
            }
          />
        }
        emptyMessage="Nenhuma viagem nesse filtro."
        viewMode={viewMode}
        renderMobileCard={(v) => <ViagemCard v={v} />}
      />
    </div>
  );
}

/**
 * Card de viagem (celular e modo grade). Leitura de cima pra baixo, uma
 * informação por linha, cada uma com seu ícone:
 *   status/alertas · quando foi criada
 *   carga  ↑
 *   descarga ↓
 *   motorista
 *   placa · material · cliente
 *   toneladas · km · ticket
 *
 * O "(informado X)" do mínimo fica só no detalhe da viagem (`semAnotacao`) —
 * no card ele quebrava a linha das métricas.
 */
function ViagemCard({ v }: { v: Viagem }) {
  return (
    <Link href={`/viagens/${v.id}`} className="block group">
      <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
        <div className="flex flex-col gap-3 p-4">
          {/* Cabeçalho: status/alertas de um lado, quando a viagem foi criada do
              outro (sem rótulo — o relógio já diz o que é). */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge className={STATUS_VIAGEM_COLOR[v.status] ?? ""}>
                {STATUS_VIAGEM_LABEL[v.status] ?? v.status}
              </Badge>
              {v.iniciadaGuiada && (
                <Badge
                  className="border-indigo-200 bg-indigo-100 text-indigo-800"
                  title="Lançada pelo fluxo guiado 'Iniciar viagem'"
                >
                  Guiada
                </Badge>
              )}
              <AlertasBadges v={v} />
            </div>
            <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
              {v.fotos.length > 0 && (
                <span
                  className="flex items-center gap-0.5"
                  title={`${v.fotos.length} foto${v.fotos.length === 1 ? "" : "s"}`}
                >
                  <Camera className="h-3.5 w-3.5" /> {v.fotos.length}
                </span>
              )}
              <span className="flex items-center gap-1" title="Quando a viagem foi criada">
                <Clock className="h-3.5 w-3.5" />
                {criadoEm(v)}
              </span>
            </span>
          </div>

          {/* Trajeto: carga em cima, descarga embaixo (uma por linha) */}
          <div className="space-y-1 text-sm font-medium">
            <span className="flex min-w-0 items-center gap-1.5">
              <ArrowUp className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="truncate">{v.localCarga.nome}</span>
            </span>
            {v.localDescarga && (
              <span className="flex min-w-0 items-center gap-1.5">
                <ArrowDown className="h-4 w-4 shrink-0 text-rose-600" />
                <span className="truncate">{v.localDescarga.nome}</span>
              </span>
            )}
          </div>

          {/* Motorista sozinho na linha; placa, material e cliente na de baixo */}
          <div className="space-y-1">
            <InfoIcone icon={User} className="text-sm">
              {v.motorista.nome}
            </InfoIcone>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <InfoIcone icon={Truck}>
                <span className="font-mono">{v.veiculo.placa}</span>
              </InfoIcone>
              {v.material && <InfoIcone icon={Package}>{v.material.nome}</InfoIcone>}
              {ehPeriodo(v) && (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                  {v.tipoServico?.nome ?? "Diária"}
                </span>
              )}
              {v.cliente && <InfoIcone icon={Building2}>{v.cliente.nome}</InfoIcone>}
            </div>
          </div>

          {/* Métricas numa linha só, separadas por uma régua. Foto e "criada em"
              ficam no cabeçalho pra sobrar largura pras três aqui no celular. */}
          <div className="flex items-center gap-2 border-t border-border/60 pt-3">
            {/* nowrap: as três métricas ficam sempre na mesma linha; quem
                encolhe é o ticket (o mais longo e o menos crítico de ler) */}
            <div className="flex min-w-0 flex-1 items-center justify-between gap-x-3 overflow-hidden text-sm font-semibold tabular-nums sm:justify-start sm:gap-x-8">
              {ehPeriodo(v) ? (
                <InfoIcone icon={Clock} className="shrink-0">
                  {v.saidaEm ? formatarDuracao(v.duracaoMinutos) : "em aberto"}
                </InfoIcone>
              ) : (
                <InfoIcone icon={Weight} className="shrink-0">
                  <ValorComMinimo
                    efetivo={v.toneladasEfetiva}
                    real={v.toneladasInformada}
                    ajustada={v.toneladasAjustada}
                    unidade="t"
                    casas={3}
                    semAnotacao
                  />
                </InfoIcone>
              )}
              <InfoIcone icon={Route} className="shrink-0">
                <ValorComMinimo
                  efetivo={v.kmEfetivo}
                  real={v.kmInformado}
                  ajustada={v.kmAjustada}
                  unidade="km"
                  casas={2}
                  semAnotacao
                />
              </InfoIcone>
              <InfoIcone icon={Ticket}>
                {v.ticket ? (
                  <span className="font-mono">
                    {v.ticket}
                    {v.ocrCampos && v.ocrCampos.length > 0 && (
                      <span
                        className="ml-1 text-xs text-indigo-600"
                        title={`Campos pela IA: ${v.ocrCampos.join(", ")}`}
                      >
                        ✨
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs font-normal italic text-muted-foreground">
                    {v.material?.exigeTicket ?? false ? "sem ticket" : "não exige"}
                  </span>
                )}
              </InfoIcone>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </Card>
    </Link>
  );
}

