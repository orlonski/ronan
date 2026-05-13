"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, Download } from "lucide-react";
import {
  ROTULO_DOCUMENTO_MOTORISTA,
  TIPOS_DOCUMENTO_MOTORISTA,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuthToken } from "@/lib/client-api";
import { baixarZipDocumentos } from "@/lib/motorista-documentos-api";
import { statusDocumento, type DocumentoStatus } from "@/lib/documento-status";

export type DocumentoResumo = {
  tipo: TipoDocumentoMotorista;
  validade: string | null;
};

type Props = {
  motoristaId: string;
  motoristaNome: string;
  documentos: DocumentoResumo[];
};

export function DocumentosBadge({ motoristaId, motoristaNome, documentos }: Props) {
  const [baixando, setBaixando] = useState(false);
  const token = useAuthToken();
  const porTipo = new Map(documentos.map((d) => [d.tipo, d]));

  let okCount = 0;
  let vencendoCount = 0;
  let vencidoCount = 0;
  let faltandoCount = 0;
  for (const tipo of TIPOS_DOCUMENTO_MOTORISTA) {
    const s = statusDocumento(porTipo.get(tipo));
    if (s === "OK") okCount++;
    else if (s === "A_VENCER") vencendoCount++;
    else if (s === "VENCIDO") vencidoCount++;
    else faltandoCount++;
  }

  const total = TIPOS_DOCUMENTO_MOTORISTA.length;
  const presentes = okCount + vencendoCount + vencidoCount;

  let badgeClass = "bg-muted text-muted-foreground";
  if (vencidoCount > 0 || faltandoCount > 0) badgeClass = "bg-red-100 text-red-700";
  else if (vencendoCount > 0) badgeClass = "bg-amber-100 text-amber-700";
  else if (presentes === total) badgeClass = "bg-emerald-100 text-emerald-700";

  async function onBaixarZip() {
    if (!token) return;
    setBaixando(true);
    try {
      await baixarZipDocumentos(motoristaId, token, `documentos-${motoristaNome}.zip`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao baixar zip");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`rounded px-2 py-0.5 text-xs font-medium tabular-nums transition-opacity hover:opacity-80 ${badgeClass}`}
          title="Ver status dos documentos"
        >
          {presentes}/{total}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Documentos</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBaixarZip}
              disabled={presentes === 0 || baixando}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="ml-1">Zip</span>
            </Button>
          </div>
          <ul className="space-y-1">
            {TIPOS_DOCUMENTO_MOTORISTA.map((tipo) => {
              const doc = porTipo.get(tipo);
              const status = statusDocumento(doc);
              return (
                <li key={tipo} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <StatusIcon status={status} />
                    {ROTULO_DOCUMENTO_MOTORISTA[tipo]}
                  </span>
                  <StatusLabel status={status} validade={doc?.validade ?? null} />
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StatusIcon({ status }: { status: DocumentoStatus }) {
  if (status === "OK") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === "A_VENCER") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "VENCIDO") return <AlertCircle className="h-3.5 w-3.5 text-red-600" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

function StatusLabel({ status, validade }: { status: DocumentoStatus; validade: string | null }) {
  if (status === "FALTANDO") return <span className="text-muted-foreground">—</span>;
  if (status === "OK") {
    if (!validade) return <span className="text-emerald-700">OK</span>;
    return <span className="text-emerald-700">{formatBR(validade)}</span>;
  }
  if (status === "A_VENCER") return <span className="text-amber-700">{formatBR(validade!)}</span>;
  return <span className="text-red-700">{formatBR(validade!)}</span>;
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
