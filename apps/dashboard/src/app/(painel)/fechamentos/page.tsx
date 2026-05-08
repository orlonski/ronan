"use client";

import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingCard, LoadingInline } from "@/components/loading";
import { useFechamentos } from "@/lib/fechamentos-api";
import {
  STATUS_FECHAMENTO_COLOR,
  STATUS_FECHAMENTO_LABEL,
  fmtBR,
  fmtDataHoraBR,
} from "@/lib/fechamento-helpers";

export default function FechamentosPage() {
  const list = useFechamentos({});

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fechamentos</h1>
          <p className="text-sm text-muted-foreground">
            Conferências de planilhas que as empresas-cliente enviam — extração + match automático com IA.
          </p>
        </div>
        <Link href="/fechamentos/novo">
          <Button className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Novo fechamento
          </Button>
        </Link>
      </header>

      {/* Mobile: cards verticais */}
      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <LoadingCard />
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum fechamento ainda. Clique em &quot;Novo fechamento&quot; pra subir
            a primeira planilha.
          </Card>
        )}
        {list.data?.map((f) => (
          <Link key={f.id} href={`/fechamentos/${f.id}`} className="block">
            <Card className="space-y-3 p-4 hover:bg-muted/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {f.empresaCliente.nome}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBR(f.periodoInicio)} → {fmtBR(f.periodoFim)} · v{f.versao}
                  </p>
                </div>
                <Badge className={STATUS_FECHAMENTO_COLOR[f.status]}>
                  {STATUS_FECHAMENTO_LABEL[f.status]}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
                <span>
                  <span className="text-muted-foreground">Linhas: </span>
                  <span className="font-medium">{f._count.linhas}</span>
                </span>
                {f.resumoIa && (
                  <span>
                    <span className="text-muted-foreground">OK: </span>
                    <span className="font-medium">
                      {f.resumoIa.matchAuto + f.resumoIa.matchIa}
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      · {f.resumoIa.divergencia} pendentes
                    </span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  Recebido {fmtDataHoraBR(f.criadoEm)}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Desktop: tabela */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Linhas</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Recebido</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={7}><LoadingInline /></TableCell>
              </TableRow>
            )}
            {list.data?.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.empresaCliente.nome}</TableCell>
                <TableCell className="text-sm">
                  {fmtBR(f.periodoInicio)} → {fmtBR(f.periodoFim)}
                </TableCell>
                <TableCell className="text-sm">v{f.versao}</TableCell>
                <TableCell className="text-sm">
                  {f._count.linhas} linhas
                  {f.resumoIa && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({f.resumoIa.matchAuto + f.resumoIa.matchIa} OK · {f.resumoIa.divergencia} pendentes)
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_FECHAMENTO_COLOR[f.status]}>
                    {STATUS_FECHAMENTO_LABEL[f.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {fmtDataHoraBR(f.criadoEm)}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/fechamentos/${f.id}`}>
                    <Button variant="ghost" size="sm">
                      <FileSpreadsheet className="h-4 w-4" /> Abrir
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Nenhum fechamento ainda. Clique em "Novo fechamento" pra subir a primeira planilha.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
