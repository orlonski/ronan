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

const FILTROS_STATUS = ["TODOS", "MATCH", "MATCH_IA", "DIVERGENCIA", "RESOLVIDA_OPERADORA"] as const;
const TIPOS = ["VIAGEM", "PEDAGIO", "COMBUSTIVEL"] as const;

const TIPO_LABEL: Record<(typeof TIPOS)[number], string> = {
  VIAGEM: "🚛 Viagens",
  PEDAGIO: "🛣️ Pedágios",
  COMBUSTIVEL: "⛽ Combustível",
};

export function LinhasTab({ fechamentoId }: { fechamentoId: string }) {
  const [filtroStatus, setFiltroStatus] =
    useState<(typeof FILTROS_STATUS)[number]>("TODOS");
  const [tipoTab, setTipoTab] = useState<(typeof TIPOS)[number]>("VIAGEM");
  const linhas = useLinhasFechamento(
    fechamentoId,
    filtroStatus === "TODOS" ? undefined : filtroStatus,
    tipoTab,
  );

  return (
    <div className="space-y-4">
      {/* Tabs por tipo */}
      <div className="flex flex-wrap gap-1 border-b">
        {TIPOS.map((t) => (
          <button
            key={t}
            onClick={() => setTipoTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tipoTab === t
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TIPO_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Filtro de status */}
      <div className="flex flex-wrap gap-2">
        {FILTROS_STATUS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltroStatus(f)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              filtroStatus === f
                ? "bg-blue-600 text-white"
                : "border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "TODOS" ? "Todas" : STATUS_LINHA_LABEL[f as never]}
          </button>
        ))}
      </div>

      <Card>
        {tipoTab === "VIAGEM" && <TabelaViagens linhas={linhas.data} loading={linhas.isLoading} />}
        {tipoTab === "PEDAGIO" && <TabelaPedagios linhas={linhas.data} loading={linhas.isLoading} />}
        {tipoTab === "COMBUSTIVEL" && (
          <TabelaCombustivel linhas={linhas.data} loading={linhas.isLoading} />
        )}
      </Card>
    </div>
  );
}

type Linha = NonNullable<ReturnType<typeof useLinhasFechamento>["data"]>[number];

function TabelaViagens({ linhas, loading }: { linhas: Linha[] | undefined; loading: boolean }) {
  return (
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
        {loading && (
          <TableRow>
            <TableCell colSpan={9}>Carregando...</TableCell>
          </TableRow>
        )}
        {linhas?.map((l) => (
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
        {linhas?.length === 0 && (
          <TableRow>
            <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
              Nenhuma linha de viagem. Configure o bloco "Viagens" e reprocesse o fechamento.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function TabelaPedagios({ linhas, loading }: { linhas: Linha[] | undefined; loading: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Placa</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Praça</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Pedágio (banco)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell colSpan={7}>Carregando...</TableCell>
          </TableRow>
        )}
        {linhas?.map((l) => {
          const praca =
            (l.rawData as { _custom?: { praca_pedagio?: string } } | null)?._custom
              ?.praca_pedagio ?? "—";
          return (
            <TableRow key={l.id}>
              <TableCell className="text-xs text-muted-foreground">{l.ordem}</TableCell>
              <TableCell className="font-mono text-sm">{l.placa ?? "—"}</TableCell>
              <TableCell className="text-sm">{fmtBR(l.data)}</TableCell>
              <TableCell className="text-sm">{String(praca)}</TableCell>
              <TableCell className="text-sm">{fmtBRL(l.valor)}</TableCell>
              <TableCell>
                <Badge className={STATUS_LINHA_COLOR[l.status]}>
                  {STATUS_LINHA_LABEL[l.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">
                {(l as { pedagioMatch?: { id: string } | null }).pedagioMatch ? (
                  <span className="text-green-700">✓ Encontrado</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {linhas?.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
              Nenhuma linha de pedágio. Configure o bloco "Pedágios" e reprocesse.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function TabelaCombustivel({
  linhas,
  loading,
}: {
  linhas: Linha[] | undefined;
  loading: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Placa</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Litros</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Abast. (banco)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell colSpan={7}>Carregando...</TableCell>
          </TableRow>
        )}
        {linhas?.map((l) => {
          const litros =
            (l.rawData as { _custom?: { litros?: number } } | null)?._custom?.litros ??
            null;
          return (
            <TableRow key={l.id}>
              <TableCell className="text-xs text-muted-foreground">{l.ordem}</TableCell>
              <TableCell className="font-mono text-sm">{l.placa ?? "—"}</TableCell>
              <TableCell className="text-sm">{fmtBR(l.data)}</TableCell>
              <TableCell className="text-sm">
                {typeof litros === "number" ? `${litros.toFixed(2)} L` : "—"}
              </TableCell>
              <TableCell className="text-sm">{fmtBRL(l.valor)}</TableCell>
              <TableCell>
                <Badge className={STATUS_LINHA_COLOR[l.status]}>
                  {STATUS_LINHA_LABEL[l.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">
                {(l as { abastecimentoMatch?: { id: string } | null }).abastecimentoMatch ? (
                  <span className="text-green-700">✓ Encontrado</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {linhas?.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
              Nenhuma linha de combustível. Configure o bloco "Combustível" e reprocesse.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
