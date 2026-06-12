"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bell, Check } from "lucide-react";
import type {
  ListarNotificacoesAdminResponse,
  NotificacaoAdminItem,
} from "@ronan/shared-types";
import { Spinner } from "@/components/loading";
import { partesSP } from "@/lib/datetime-br";
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

/**
 * Últimas 10 notificações enviadas pra esse motorista. Mostra na ficha de
 * edição. Link "Ver tudo" leva pra /notificacoes pré-filtrado.
 */
export function HistoricoNotificacoes({ motoristaId }: { motoristaId: string }) {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["motorista-notificacoes", motoristaId, token],
    enabled: !!token,
    queryFn: () =>
      fetchApi<ListarNotificacoesAdminResponse>(
        `/admin/notificacoes?motoristaId=${motoristaId}&limit=10`,
        { token },
      ),
  });

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Histórico de notificações</h2>
          <p className="text-xs text-muted-foreground">
            Últimas 10 push enviadas pra esse motorista.
          </p>
        </div>
        <Link
          href={{ pathname: "/notificacoes", query: { motoristaId } }}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Ver tudo
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {q.isLoading && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}

      {!q.isLoading && (q.data?.itens.length ?? 0) === 0 && (
        <div className="py-6 text-center text-sm text-muted-foreground">
          <Bell className="mx-auto mb-2 h-5 w-5 opacity-50" />
          Sem notificações enviadas pra esse motorista ainda.
        </div>
      )}

      {!q.isLoading && (q.data?.itens.length ?? 0) > 0 && (
        <ul className="divide-y">
          {q.data!.itens.map((n) => (
            <NotificacaoItem key={n.id} n={n} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NotificacaoItem({ n }: { n: NotificacaoAdminItem }) {
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium" title={n.titulo}>
            {n.titulo}
          </p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{n.corpo}</p>
          <p
            className="mt-1 font-mono text-xs text-muted-foreground"
            style={{ fontVariant: "tabular-nums" }}
          >
            {fmtDataHora(n.criadoEm)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={n.entregaStatus} />
          {n.lida && (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-700">
              <Check className="h-3 w-3" /> Lida
            </span>
          )}
        </div>
      </div>
      {n.entregaErro && (
        <p
          className="mt-1 text-[10px] text-destructive line-clamp-1"
          title={n.entregaErro}
        >
          {n.entregaErro}
        </p>
      )}
    </li>
  );
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const t = partesSP(d);
  return `${t.dia}/${t.mes} ${t.hora}:${t.min}`;
}
