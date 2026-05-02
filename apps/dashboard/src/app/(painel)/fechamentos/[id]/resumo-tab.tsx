"use client";

import { Card } from "@/components/ui/card";
import {
  fmtBR,
  fmtDataHoraBR,
} from "@/lib/fechamento-helpers";
import type { FechamentoDetalhe } from "@/lib/fechamentos-api";

export function ResumoTab({ fechamento }: { fechamento: FechamentoDetalhe }) {
  const r = fechamento.resumoIa;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-3 text-base font-medium">Identificação</h3>
        <dl className="space-y-2 text-sm">
          <Row label="Empresa" value={fechamento.empresaCliente.nome} />
          <Row
            label="Período"
            value={`${fmtBR(fechamento.periodoInicio)} → ${fmtBR(fechamento.periodoFim)}`}
          />
          <Row label="Versão" value={`v${fechamento.versao}`} />
          <Row label="Arquivo original" value={fechamento.arquivoOriginalNome ?? "—"} mono />
          <Row label="Recebido em" value={fmtDataHoraBR(fechamento.criadoEm)} />
        </dl>
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 text-base font-medium">Processamento da IA</h3>
        {r ? (
          <dl className="space-y-2 text-sm">
            <Row label="Total de linhas extraídas" value={r.total} />
            <Row label="Match automático (placa+data+ticket)" value={r.matchAuto} />
            <Row label="Match com sugestão da IA" value={r.matchIa} />
            <Row label="Pendentes para conferência" value={r.divergencia} />
            <Row label="Faltando (motorista não lançou)" value={r.faltando ?? 0} />
            <Row label="Extra (lançou e cliente não tem)" value={r.extra ?? 0} />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Aguardando processamento...</p>
        )}
        <p className="mt-4 rounded-md bg-blue-50 p-3 text-xs text-blue-800">
          Linhas que a IA conseguiu casar com confidence ≥ 85% foram resolvidas automaticamente.
          As que ficaram em <strong>Pendentes</strong> precisam de revisão da operadora na aba
          Conferência.
        </p>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{value}</dd>
    </div>
  );
}
