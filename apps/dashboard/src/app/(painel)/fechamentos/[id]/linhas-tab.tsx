"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  STATUS_LINHA_COLOR,
  STATUS_LINHA_LABEL,
  fmtBR,
  fmtBRL,
  fmtNum,
} from "@/lib/fechamento-helpers";
import { useLinhasFechamento } from "@/lib/fechamentos-api";

const FILTROS = ["TODOS", "MATCH", "MATCH_IA", "DIVERGENCIA", "RESOLVIDA_OPERADORA"] as const;

export function LinhasTab({ fechamentoId }: { fechamentoId: string }) {
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>("TODOS");
  const linhas = useLinhasFechamento(fechamentoId, filtro === "TODOS" ? undefined : filtro);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              filtro === f
                ? "bg-blue-600 text-white"
                : "border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "TODOS" ? "Todas" : STATUS_LINHA_LABEL[f as never]}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead>Toneladas</TableHead>
              <TableHead>Km</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Viagem (banco)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.isLoading && (
              <TableRow>
                <TableCell colSpan={9}>Carregando...</TableCell>
              </TableRow>
            )}
            {linhas.data?.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs text-muted-foreground">{l.ordem}</TableCell>
                <TableCell className="font-mono text-sm">{l.placa ?? "—"}</TableCell>
                <TableCell className="text-sm">{fmtBR(l.data)}</TableCell>
                <TableCell className="font-mono text-sm">{l.ticket ?? "—"}</TableCell>
                <TableCell className="text-sm">{fmtNum(l.toneladas, 3)}</TableCell>
                <TableCell className="text-sm">{fmtNum(l.km, 2)}</TableCell>
                <TableCell className="text-sm">{fmtBRL(l.valor)}</TableCell>
                <TableCell>
                  <Badge className={STATUS_LINHA_COLOR[l.status]}>
                    {STATUS_LINHA_LABEL[l.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {l.viagemMatch ? (
                    <span>
                      {l.viagemMatch.veiculo.placa} · {l.viagemMatch.motorista.nome.split(" ")[0]}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {linhas.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                  Nenhuma linha nesse filtro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
