"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingCard, Spinner } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ErroAgrupado = {
  hash: string;
  origem: string;
  message: string;
  ocorrencias: number;
  primeiraOcorrencia: string;
  ultimaOcorrencia: string;
  resolvido: boolean;
  resolvidoEm: string | null;
};

type StatusFiltro = "pendentes" | "resolvidos" | "todos";

type ErroDetalhe = {
  id: string;
  hash: string;
  origem: string;
  message: string;
  stack: string | null;
  versao: string | null;
  userId: string | null;
  userType: string | null;
  url: string | null;
  userAgent: string | null;
  extra: unknown;
  capturadoEm: string;
};

const ORIGEM_LABEL: Record<string, string> = {
  "motorista-app": "App",
  dashboard: "Dashboard",
  api: "API",
};

const ORIGEM_COLOR: Record<string, string> = {
  "motorista-app": "border-blue-200 bg-blue-50 text-blue-800",
  dashboard: "border-purple-200 bg-purple-50 text-purple-800",
  api: "border-red-200 bg-red-50 text-red-800",
};

export default function ErrosPage() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [origem, setOrigem] = useState<string>("");
  const [status, setStatus] = useState<StatusFiltro>("pendentes");
  const [hashSelecionado, setHashSelecionado] = useState<string | null>(null);
  const { viewMode, setViewMode } = useListViewMode("erros");

  const grupos = useQuery({
    queryKey: ["errors-agrupados", origem, status, token],
    enabled: !!token,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (origem) qs.set("origem", origem);
      qs.set("status", status);
      qs.set("limit", "100");
      return fetchApi<ErroAgrupado[]>(
        `/errors/agrupados?${qs.toString()}`,
        { token },
      );
    },
  });

  const ocorrencias = useQuery({
    queryKey: ["errors-listar", hashSelecionado, token],
    enabled: !!token && !!hashSelecionado,
    queryFn: () =>
      fetchApi<ErroDetalhe[]>(
        `/errors?hash=${hashSelecionado}&limit=200`,
        { token },
      ),
  });

  const resolver = useMutation({
    mutationFn: (hash: string) =>
      fetchApi<{ count: number }>(`/errors/grupo/${hash}/resolver`, {
        method: "PATCH",
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["errors-agrupados"] }),
  });

  const reabrir = useMutation({
    mutationFn: (hash: string) =>
      fetchApi<{ count: number }>(`/errors/grupo/${hash}/reabrir`, {
        method: "PATCH",
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["errors-agrupados"] }),
  });

  if (hashSelecionado) {
    const grupoSelecionado = grupos.data?.find((g) => g.hash === hashSelecionado);
    return (
      <DetalheErro
        hash={hashSelecionado}
        ocorrencias={ocorrencias.data ?? []}
        loading={ocorrencias.isLoading}
        resolvido={grupoSelecionado?.resolvido ?? false}
        onResolver={() => resolver.mutate(hashSelecionado)}
        onReabrir={() => reabrir.mutate(hashSelecionado)}
        resolvendo={resolver.isPending || reabrir.isPending}
        onVoltar={() => setHashSelecionado(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Erros</h1>
          <p className="text-sm text-muted-foreground">
            Crashes do app, dashboard e backend agrupados por tipo. Clique pra
            ver ocorrências e stack trace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            value={status}
            onChange={(v) => setStatus((v ?? "pendentes") as StatusFiltro)}
            placeholder="Status"
            showSearch={false}
            options={[
              { value: "pendentes", label: "Pendentes" },
              { value: "resolvidos", label: "Resolvidos" },
              { value: "todos", label: "Todos" },
            ]}
          />
          <Combobox
            value={origem || undefined}
            onChange={(v) => setOrigem(v ?? "")}
            placeholder="Origem"
            showSearch={false}
            options={[
              { value: "motorista-app", label: "App motorista" },
              { value: "dashboard", label: "Dashboard" },
              { value: "api", label: "API (backend)" },
            ]}
          />
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
      </header>

      {grupos.isLoading && <LoadingCard />}
      {grupos.data?.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {status === "pendentes"
            ? "Nenhum erro pendente. ✓"
            : status === "resolvidos"
            ? "Nenhum erro resolvido ainda."
            : "Nenhum erro registrado. ✓"}
        </Card>
      )}

      {viewMode === "cards" && (
        <div className="space-y-3">
          {grupos.data?.map((g) => (
            <Card
              key={g.hash}
              className="cursor-pointer overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md"
              onClick={() => setHashSelecionado(g.hash)}
            >
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
                <div className="flex flex-col items-start gap-1.5">
                  <Badge className={ORIGEM_COLOR[g.origem] ?? ""}>
                    {ORIGEM_LABEL[g.origem] ?? g.origem}
                  </Badge>
                  {g.resolvido ? (
                    <Badge className="border-green-200 bg-green-50 text-green-800">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Corrigido
                    </Badge>
                  ) : (
                    <Badge className="border-amber-200 bg-amber-50 text-amber-800">
                      Pendente
                    </Badge>
                  )}
                </div>

                <div className="min-w-0 space-y-1.5">
                  <p className="break-words text-sm font-medium">{g.message}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono tabular-nums">
                      {g.ocorrencias}× ocorrências
                    </span>
                    <span>·</span>
                    <span>Primeira: {fmtDataHora(g.primeiraOcorrencia)}</span>
                    <span>·</span>
                    <span>Última: {fmtDataHora(g.ultimaOcorrencia)}</span>
                  </div>
                </div>

                <div
                  className="flex shrink-0 items-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  {g.resolvido ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={reabrir.isPending}
                      onClick={() => reabrir.mutate(g.hash)}
                    >
                      {reabrir.isPending ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
                      Reabrir
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={resolver.isPending}
                      onClick={() => resolver.mutate(g.hash)}
                    >
                      {resolver.isPending ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                      Marcar como corrigido
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {viewMode === "table" && (
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origem</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead className="text-right">Ocorrências</TableHead>
              <TableHead>Primeira</TableHead>
              <TableHead>Última</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grupos.data?.map((g) => (
              <TableRow
                key={g.hash}
                className="cursor-pointer"
                onClick={() => setHashSelecionado(g.hash)}
              >
                <TableCell>
                  <Badge className={ORIGEM_COLOR[g.origem] ?? ""}>
                    {ORIGEM_LABEL[g.origem] ?? g.origem}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xl truncate text-sm">
                  {g.message}
                </TableCell>
                <TableCell className="text-right text-sm font-medium">
                  {g.ocorrencias}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDataHora(g.primeiraOcorrencia)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDataHora(g.ultimaOcorrencia)}
                </TableCell>
                <TableCell>
                  {g.resolvido ? (
                    <Badge className="border-green-200 bg-green-50 text-green-800">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Corrigido
                    </Badge>
                  ) : (
                    <Badge className="border-amber-200 bg-amber-50 text-amber-800">
                      Pendente
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {g.resolvido ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={reabrir.isPending}
                      onClick={() => reabrir.mutate(g.hash)}
                      title="Reabrir"
                    >
                      {reabrir.isPending ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={resolver.isPending}
                      onClick={() => resolver.mutate(g.hash)}
                      title="Marcar como corrigido"
                    >
                      {resolver.isPending ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      )}
    </div>
  );
}

function DetalheErro({
  hash,
  ocorrencias,
  loading,
  resolvido,
  onResolver,
  onReabrir,
  resolvendo,
  onVoltar,
}: {
  hash: string;
  ocorrencias: ErroDetalhe[];
  loading: boolean;
  resolvido: boolean;
  onResolver: () => void;
  onReabrir: () => void;
  resolvendo: boolean;
  onVoltar: () => void;
}) {
  const primeira = ocorrencias[0];
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <button
            onClick={onVoltar}
            className="mb-2 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Voltar pra lista
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Detalhe do erro
            </h1>
            {resolvido && (
              <Badge className="border-green-200 bg-green-50 text-green-800">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Corrigido
              </Badge>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            hash: {hash} · {ocorrencias.length} ocorrências
          </p>
        </div>
        {resolvido ? (
          <Button variant="outline" size="sm" disabled={resolvendo} onClick={onReabrir}>
            {resolvendo ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
            Reabrir
          </Button>
        ) : (
          <Button size="sm" disabled={resolvendo} onClick={onResolver}>
            {resolvendo ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
            Marcar como corrigido
          </Button>
        )}
      </header>

      {loading && <LoadingCard />}

      {primeira && (
        <Card className="space-y-3 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Mensagem
            </p>
            <p className="mt-1 break-words font-medium">{primeira.message}</p>
          </div>
          {primeira.stack && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Stack trace
              </p>
              <pre className="mt-1 overflow-auto rounded bg-muted/40 p-3 text-xs">
                {primeira.stack}
              </pre>
            </div>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <h2 className="border-b p-4 text-sm font-semibold">Ocorrências</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>User</TableHead>
              <TableHead>URL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ocorrencias.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="text-xs">{fmtDataHora(o.capturadoEm)}</TableCell>
                <TableCell>
                  <Badge className={ORIGEM_COLOR[o.origem] ?? ""}>
                    {ORIGEM_LABEL[o.origem] ?? o.origem}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {o.versao ?? "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {o.userId ? `${o.userType} ${o.userId.slice(0, 8)}` : "—"}
                </TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs">
                  {o.url ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
