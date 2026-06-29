"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bell, Check, Loader2, X } from "lucide-react";
import type {
  ListarNotificacoesAdminResponse,
  NotificacaoAdminItem,
} from "@ronan/shared-types";
import { formatCpf } from "@ronan/shared-types";
import { partesSP } from "@/lib/datetime-br";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Spinner } from "@/components/loading";
import { MotoristaCombobox } from "@/components/motorista-combobox";
import { ExcluirButton } from "@/components/excluir-button";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { fetchApi, useAuthToken } from "@/lib/client-api";

const statusClasses: Record<string, string> = {
  PENDENTE: "bg-amber-50 text-amber-700 border-amber-200",
  ENTREGUE: "bg-green-50 text-green-700 border-green-200",
  ERRO: "bg-red-50 text-red-700 border-red-200",
};

const statusLabel: Record<string, string> = {
  PENDENTE: "Pendente",
  ENTREGUE: "Entregue",
  ERRO: "Erro",
};

function StatusBadge({ status }: { status: string }) {
  const cls = statusClasses[status] ?? "bg-muted text-muted-foreground border";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {statusLabel[status] ?? status}
    </span>
  );
}

export default function NotificacoesAdminPage() {
  const sp = useSearchParams();
  const motoristaIdParam = sp.get("motoristaId");
  const token = useAuthToken();

  const [motoristaId, setMotoristaId] = useState<string | undefined>(
    motoristaIdParam ?? undefined,
  );
  const [entregaStatus, setEntregaStatus] = useState<string | undefined>();
  const [lida, setLida] = useState<string | undefined>();
  const { viewMode, setViewMode } = useListViewMode("notificacoes");

  const q = useInfiniteQuery({
    queryKey: ["admin-notificacoes", { motoristaId, entregaStatus, lida, token }],
    enabled: !!token,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (pageParam) qs.set("cursor", pageParam);
      if (motoristaId) qs.set("motoristaId", motoristaId);
      if (entregaStatus) qs.set("entregaStatus", entregaStatus);
      if (lida) qs.set("lida", lida);
      qs.set("limit", "30");
      return fetchApi<ListarNotificacoesAdminResponse>(
        `/admin/notificacoes?${qs.toString()}`,
        { token },
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const itens = useMemo(() => q.data?.pages.flatMap((p) => p.itens) ?? [], [q.data]);

  const hasFilters = !!motoristaId || !!entregaStatus || !!lida;

  function limparFiltros() {
    setMotoristaId(undefined);
    setEntregaStatus(undefined);
    setLida(undefined);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de notificações push enviadas pros motoristas.
          </p>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <MotoristaCombobox value={motoristaId} onChange={setMotoristaId} />
        <Combobox
          value={entregaStatus}
          onChange={setEntregaStatus}
          placeholder="Entrega"
          showSearch={false}
          options={[
            { value: "PENDENTE", label: "Pendente" },
            { value: "ENTREGUE", label: "Entregue" },
            { value: "ERRO", label: "Erro" },
          ]}
        />
        <Combobox
          value={lida}
          onChange={setLida}
          placeholder="Lida"
          showSearch={false}
          options={[
            { value: "true", label: "Lidas" },
            { value: "false", label: "Não lidas" },
          ]}
        />
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={limparFiltros}
            className="h-10 text-muted-foreground"
          >
            Limpar
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {viewMode === "table" ? (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">Quando</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Mensagem</TableHead>
                <TableHead className="w-[120px]">Criado por</TableHead>
                <TableHead className="w-[110px]">Entrega</TableHead>
                <TableHead className="w-[80px]">Lida</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">
                    <Spinner />
                  </TableCell>
                </TableRow>
              )}
              {!q.isLoading && itens.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    <Bell className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    Nenhuma notificação encontrada.
                  </TableCell>
                </TableRow>
              )}
              {itens.map((n) => (
                <NotificacaoRow key={n.id} n={n} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-3">
          {q.isLoading && (
            <Card className="p-6 text-center">
              <Spinner />
            </Card>
          )}
          {!q.isLoading && itens.length === 0 && (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              <Bell className="mx-auto mb-2 h-6 w-6 opacity-50" />
              Nenhuma notificação encontrada.
            </Card>
          )}
          {itens.map((n) => (
            <NotificacaoCard key={n.id} n={n} />
          ))}
        </div>
      )}

      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </>
            ) : (
              "Carregar mais"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function NotificacaoCard({ n }: { n: NotificacaoAdminItem }) {
  return (
    <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-6">
        <div className="flex flex-col items-start gap-1.5">
          <StatusBadge status={n.entregaStatus} />
          {n.lida && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700">
              <Check className="h-3 w-3" /> Lida
            </span>
          )}
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{n.titulo}</span>
            <Link
              href={`/motoristas/${n.motorista.id}`}
              className="text-xs text-muted-foreground hover:underline"
            >
              {n.motorista.nome}
            </Link>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{n.corpo}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{fmtDataHora(n.criadoEm)}</span>
            {n.criadoPor && (
              <>
                <span>·</span>
                <span>por {n.criadoPor.nome}</span>
              </>
            )}
          </div>
          {n.entregaErro && (
            <p
              className="line-clamp-2 text-xs text-destructive"
              title={n.entregaErro}
            >
              {n.entregaErro}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <ExcluirButton perm="notificacoes.excluir"
            path="/admin/notificacoes"
            id={n.id}
            nomeRecurso="esta notificação"
            invalidateKeys={[["admin-notificacoes"]]}
          />
        </div>
      </div>
    </Card>
  );
}

function NotificacaoRow({ n }: { n: NotificacaoAdminItem }) {
  return (
    <TableRow>
      <TableCell
        className="font-mono text-xs text-muted-foreground"
        style={{ fontVariant: "tabular-nums" }}
      >
        {fmtDataHora(n.criadoEm)}
      </TableCell>
      <TableCell>
        <Link
          href={`/motoristas/${n.motorista.id}`}
          className="text-sm font-medium hover:underline"
        >
          {n.motorista.nome}
        </Link>
        <p className="font-mono text-xs text-muted-foreground">
          {formatCpf(n.motorista.cpf)}
        </p>
      </TableCell>
      <TableCell className="font-medium">{n.titulo}</TableCell>
      <TableCell className="max-w-md text-sm text-muted-foreground">
        <span className="line-clamp-2">{n.corpo}</span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {n.criadoPor?.nome ?? "—"}
      </TableCell>
      <TableCell>
        <StatusBadge status={n.entregaStatus} />
        {n.entregaErro && (
          <p
            className="mt-1 text-[10px] text-destructive line-clamp-2"
            title={n.entregaErro}
          >
            {n.entregaErro}
          </p>
        )}
      </TableCell>
      <TableCell>
        {n.lida ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <Check className="h-3.5 w-3.5" /> Lida
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <ExcluirButton perm="notificacoes.excluir"
          path="/admin/notificacoes"
          id={n.id}
          nomeRecurso="esta notificação"
          invalidateKeys={[["admin-notificacoes"]]}
        />
      </TableCell>
    </TableRow>
  );
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const t = partesSP(d);
  return `${t.dia}/${t.mes} ${t.hora}:${t.min}`;
}
