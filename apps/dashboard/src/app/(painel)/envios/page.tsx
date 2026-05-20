"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, Plus, Send } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useResourceOptions } from "@/lib/client-api";
import { fmtBR, fmtDataHoraBR } from "@/lib/fechamento-helpers";
import {
  useBaixarArquivo,
  useEnvios,
  useMarcarEnvioEnviado,
  type EnvioStandalone,
} from "@/lib/fechamentos-api";

type Empresa = { id: string; nome: string };

export default function EnviosPage() {
  const tableState = useDataTableState({
    defaultSort: { field: "geradoEm", order: "desc" },
  });
  const list = useEnvios(tableState);
  const empresas = useResourceOptions<Empresa>("/admin/empresas");
  const marcar = useMarcarEnvioEnviado();
  const baixar = useBaixarArquivo();
  const [editando, setEditando] = useState<EnvioStandalone | null>(null);
  const [canalEnvio, setCanalEnvio] = useState("WhatsApp");
  const [observacao, setObservacao] = useState("");

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const columns = useMemo<ColumnDef<EnvioStandalone>[]>(
    () => [
      {
        id: "empresa",
        accessorKey: "empresa.nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.empresa?.nome ?? "—"}</span>
        ),
      },
      {
        id: "periodo",
        enableSorting: false,
        header: "Período",
        cell: ({ row }) => {
          const e = row.original;
          const inicio = e.periodoInicio ?? e.fechamento?.periodoInicio;
          const fim = e.periodoFim ?? e.fechamento?.periodoFim;
          return <span className="text-sm">{fmtBR(inicio)} → {fmtBR(fim)}</span>;
        },
      },
      {
        id: "origem",
        enableSorting: false,
        header: "Origem",
        cell: ({ row }) =>
          row.original.fechamentoId ? (
            <Badge className="border-purple-200 bg-purple-50 text-purple-800">
              Fechamento v{row.original.fechamento?.versao}
            </Badge>
          ) : (
            <Badge className="border-blue-200 bg-blue-50 text-blue-800">Direto</Badge>
          ),
      },
      {
        id: "linhas",
        enableSorting: false,
        header: "Linhas",
        cell: ({ row }) => row.original.totalLinhas ?? "—",
      },
      {
        id: "layout",
        accessorKey: "layout.nome",
        enableSorting: false,
        header: "Layout",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.layout?.nome ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) =>
          row.original.status === "ENVIADO" ? (
            <Badge className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Enviado
            </Badge>
          ) : (
            <Badge className="border-blue-200 bg-blue-50 text-blue-800">Gerado</Badge>
          ),
      },
      {
        id: "geradoEm",
        accessorKey: "geradoEm",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Gerado em" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {fmtDataHoraBR(row.original.geradoEm)}
          </span>
        ),
      },
      {
        id: "acoes",
        size: 140,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex justify-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                title="Baixar"
                onClick={() => baixar(`/admin/envios/${e.id}/download`, e.arquivoNome)}
              >
                <Download className="h-4 w-4" />
              </Button>
              {e.status === "GERADO" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditando(e)}
                  title="Marcar como enviado"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
              <ExcluirButton
                path="/admin/envios"
                id={e.id}
                nomeRecurso={`o envio de ${e.empresa?.nome ?? "—"}`}
                invalidateKeys={[["/admin/envios"]]}
              />
            </div>
          );
        },
      },
    ],
    [baixar],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Envios</h1>
          <p className="text-sm text-muted-foreground">
            Planilhas geradas pra mandar pras empresas que recebem o fechamento.
          </p>
        </div>
        <Link href="/envios/novo">
          <Button className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Novo envio
          </Button>
        </Link>
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
            searchPlaceholder="Buscar por nome do arquivo, canal, empresa…"
            filters={
              <>
                <ToolbarFilterSelect
                  label="Empresa"
                  value={tableState.filters.empresaId}
                  onChange={(v) => tableState.setFilter("empresaId", v)}
                  options={empresaOptions}
                />
                <ToolbarFilterSelect
                  label="Status"
                  value={tableState.filters.status}
                  onChange={(v) => tableState.setFilter("status", v)}
                  options={[
                    { value: "GERADO", label: "Gerado" },
                    { value: "ENVIADO", label: "Enviado" },
                  ]}
                />
              </>
            }
          />
        }
        emptyMessage='Nenhum envio gerado ainda. Clique em "Novo envio" pra gerar.'
        renderMobileCard={(e) => {
          const periodoInicio = e.periodoInicio ?? e.fechamento?.periodoInicio;
          const periodoFim = e.periodoFim ?? e.fechamento?.periodoFim;
          return (
            <Card className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.empresa?.nome ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBR(periodoInicio)} → {fmtBR(periodoFim)}
                  </p>
                </div>
                {e.status === "ENVIADO" ? (
                  <Badge className="shrink-0 border-green-200 bg-green-50 text-green-800">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Enviado
                  </Badge>
                ) : (
                  <Badge className="shrink-0 border-blue-200 bg-blue-50 text-blue-800">
                    Gerado
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {e.fechamentoId ? (
                  <span className="text-purple-700">Fechamento v{e.fechamento?.versao}</span>
                ) : (
                  <span className="text-blue-700">Direto</span>
                )}
                {e.totalLinhas != null && (
                  <span>
                    <span className="text-muted-foreground">Linhas: </span>
                    {e.totalLinhas}
                  </span>
                )}
                {e.layout?.nome && (
                  <span className="text-muted-foreground">{e.layout.nome}</span>
                )}
              </div>
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Baixar"
                  onClick={() => baixar(`/admin/envios/${e.id}/download`, e.arquivoNome)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {e.status === "GERADO" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditando(e)}
                    title="Marcar como enviado"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
                <ExcluirButton
                  path="/admin/envios"
                  id={e.id}
                  nomeRecurso={`o envio de ${e.empresa?.nome ?? "—"}`}
                  invalidateKeys={[["/admin/envios"]]}
                />
              </div>
            </Card>
          );
        }}
      />

      <Dialog open={!!editando} onOpenChange={(open) => !open && setEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar como enviado</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Canal de envio</Label>
              <Select value={canalEnvio} onChange={(e) => setCanalEnvio(e.target.value)}>
                <option>WhatsApp</option>
                <option>E-mail</option>
                <option>Entregue pessoalmente</option>
                <option>Outro</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder='ex: "enviado no grupo da Construtora X"'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={marcar.isPending}
              onClick={async () => {
                if (!editando) return;
                await marcar.mutateAsync({
                  envioId: editando.id,
                  canalEnvio,
                  observacao: observacao || undefined,
                });
                setEditando(null);
                setObservacao("");
              }}
            >
              <Send className="h-4 w-4" /> Confirmar envio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
