"use client";

import Link from "next/link";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";
import type { FechamentoDetalhe } from "@/lib/fechamentos-api";

export function VersoesTab({ fechamento }: { fechamento: FechamentoDetalhe }) {
  const temVersoes = fechamento.substituidoPor || fechamento.substitui.length > 0;

  if (!temVersoes) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Esse fechamento ainda é a única versão. Quando a empresa-cliente mandar uma versão
          atualizada da planilha, o histórico aparecerá aqui.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="mb-4 text-base font-medium">Histórico de versões</h3>
      <ol className="relative space-y-4 border-l border-border pl-6">
        {fechamento.substitui.map((ant) => (
          <li key={ant.id} className="relative">
            <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-gray-400" />
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Versão {ant.versao}</span>
                <Link
                  href={`/fechamentos/${ant.id}`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  ver
                </Link>
              </div>
              <p className="text-xs text-muted-foreground">
                Recebida em {fmtDataHoraBR(ant.criadoEm)} · Substituída por esta versão
              </p>
            </div>
          </li>
        ))}
        <li className="relative">
          <span className="absolute -left-[28px] top-1.5 h-4 w-4 rounded-full border-2 border-background bg-blue-600" />
          <div className="rounded-md border-2 border-blue-300 bg-blue-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Versão {fechamento.versao} (atual)</span>
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            </div>
            <p className="text-xs text-muted-foreground">
              Recebida em {fmtDataHoraBR(fechamento.criadoEm)}
            </p>
          </div>
        </li>
        {fechamento.substituidoPor && (
          <li className="relative">
            <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-purple-500" />
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Versão {fechamento.substituidoPor.versao}</span>
                <Link
                  href={`/fechamentos/${fechamento.substituidoPor.id}`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  ver <ArrowRight className="inline h-3 w-3" />
                </Link>
              </div>
              <p className="text-xs text-muted-foreground">
                Recebida em {fmtDataHoraBR(fechamento.substituidoPor.criadoEm)} · Substituiu esta
              </p>
            </div>
          </li>
        )}
      </ol>
    </Card>
  );
}
