"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ErroAgrupado = {
  hash: string;
  origem: string;
  message: string;
  ocorrencias: number;
  primeiraOcorrencia: string;
  ultimaOcorrencia: string;
};

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
  const [origem, setOrigem] = useState<string>("");
  const [hashSelecionado, setHashSelecionado] = useState<string | null>(null);

  const grupos = useQuery({
    queryKey: ["errors-agrupados", origem, token],
    enabled: !!token,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (origem) qs.set("origem", origem);
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

  if (hashSelecionado) {
    return (
      <DetalheErro
        hash={hashSelecionado}
        ocorrencias={ocorrencias.data ?? []}
        loading={ocorrencias.isLoading}
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
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            className="w-full md:w-48"
          >
            <option value="">Todas origens</option>
            <option value="motorista-app">App motorista</option>
            <option value="dashboard">Dashboard</option>
            <option value="api">API (backend)</option>
          </Select>
        </div>
      </header>

      {grupos.isLoading && (
        <Card className="p-6 text-sm text-muted-foreground">Carregando...</Card>
      )}
      {grupos.data?.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nenhum erro registrado. ✓
        </Card>
      )}

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {grupos.data?.map((g) => (
          <Card
            key={g.hash}
            className="cursor-pointer space-y-2 p-4 hover:bg-muted/40"
            onClick={() => setHashSelecionado(g.hash)}
          >
            <div className="flex items-start justify-between gap-2">
              <Badge className={ORIGEM_COLOR[g.origem] ?? ""}>
                {ORIGEM_LABEL[g.origem] ?? g.origem}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {g.ocorrencias}×
              </span>
            </div>
            <p className="break-words text-sm font-medium">{g.message}</p>
            <div className="text-xs text-muted-foreground">
              Última: {fmtDataHora(g.ultimaOcorrencia)}
            </div>
          </Card>
        ))}
      </div>

      {/* Desktop: tabela */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origem</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead className="text-right">Ocorrências</TableHead>
              <TableHead>Primeira</TableHead>
              <TableHead>Última</TableHead>
              <TableHead></TableHead>
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
                <TableCell className="text-right">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function DetalheErro({
  hash,
  ocorrencias,
  loading,
  onVoltar,
}: {
  hash: string;
  ocorrencias: ErroDetalhe[];
  loading: boolean;
  onVoltar: () => void;
}) {
  const primeira = ocorrencias[0];
  return (
    <div className="space-y-6">
      <header>
        <button
          onClick={onVoltar}
          className="mb-2 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Voltar pra lista
        </button>
        <h1 className="text-2xl font-semibold tracking-tight">
          Detalhe do erro
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          hash: {hash} · {ocorrencias.length} ocorrências
        </p>
      </header>

      {loading && (
        <Card className="p-6 text-sm text-muted-foreground">Carregando...</Card>
      )}

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
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
