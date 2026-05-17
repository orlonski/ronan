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
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";

type MotoristaOpt = { id: string; nome: string; cpf: string };

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

  const motoristasOpts = useResourceOptions<MotoristaOpt>("/admin/motoristas", {
    pageSize: 500,
  });

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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="text-sm text-muted-foreground">
          Histórico de notificações push enviadas pros motoristas.
        </p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <FiltroSelect
          label="Motorista"
          value={motoristaId}
          onChange={setMotoristaId}
          options={
            motoristasOpts.data
              ? [
                  ...motoristasOpts.data.map((m) => ({
                    value: m.id,
                    label: `${m.nome} · ${formatCpf(m.cpf)}`,
                  })),
                ]
              : []
          }
        />
        <FiltroSelect
          label="Entrega"
          value={entregaStatus}
          onChange={setEntregaStatus}
          options={[
            { value: "PENDENTE", label: "Pendente" },
            { value: "ENTREGUE", label: "Entregue" },
            { value: "ERRO", label: "Erro" },
          ]}
        />
        <FiltroSelect
          label="Lida"
          value={lida}
          onChange={setLida}
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
            className="h-9 text-muted-foreground"
          >
            Limpar
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Quando</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead className="w-[110px]">Entrega</TableHead>
              <TableHead className="w-[80px]">Lida</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  <Spinner />
                </TableCell>
              </TableRow>
            )}
            {!q.isLoading && itens.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
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
    </TableRow>
  );
}

function FiltroSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Todos",
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-md border bg-background px-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        className="h-7 border-0 bg-transparent text-sm focus:ring-0"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${hh}:${mm}`;
}
