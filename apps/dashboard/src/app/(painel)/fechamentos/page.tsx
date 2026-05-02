"use client";

import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fechamentos</h1>
          <p className="text-sm text-muted-foreground">
            Conferências de planilhas que as empresas-cliente enviam — extração + match automático com IA.
          </p>
        </div>
        <Link href="/fechamentos/novo">
          <Button>
            <Plus className="h-4 w-4" /> Novo fechamento
          </Button>
        </Link>
      </header>

      <Card>
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
                <TableCell colSpan={7}>Carregando...</TableCell>
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
