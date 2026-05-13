"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, Download, Loader2, Trash2, Upload } from "lucide-react";
import {
  ROTULO_DOCUMENTO_MOTORISTA,
  type MotoristaDocumentoOutput,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthToken } from "@/lib/client-api";
import {
  baixarDocumento,
  useAtualizarValidadeDocumento,
  useRemoverDocumento,
  useUploadDocumento,
} from "@/lib/motorista-documentos-api";
import { diasParaVencer, statusDocumento, type DocumentoStatus } from "@/lib/documento-status";

type Props = {
  motoristaId: string;
  tipo: TipoDocumentoMotorista;
  doc: MotoristaDocumentoOutput | undefined;
};

export function DocumentoRow({ motoristaId, tipo, doc }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useUploadDocumento(motoristaId);
  const atualizarValidade = useAtualizarValidadeDocumento(motoristaId);
  const remover = useRemoverDocumento(motoristaId);
  const token = useAuthToken();

  // Buffer local pra evitar mandar PATCH a cada keystroke do <input type="date">.
  // Só commita no blur, e ressincroniza quando o servidor atualiza doc.validade.
  const [validadeLocal, setValidadeLocal] = useState(doc?.validade ?? "");
  useEffect(() => {
    setValidadeLocal(doc?.validade ?? "");
  }, [doc?.validade]);

  const status = statusDocumento(doc);

  async function onPick(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await upload.mutateAsync({ tipo, arquivo: file, validade: doc?.validade ?? null });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setBusy(false);
    }
  }

  async function onValidadeBlur() {
    if (!doc) return;
    const atual = doc.validade ?? "";
    if (validadeLocal === atual) return;
    try {
      await atualizarValidade.mutateAsync({ tipo, validade: validadeLocal || null });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao atualizar validade");
    }
  }

  async function onBaixar() {
    if (!doc || !token) return;
    try {
      await baixarDocumento(motoristaId, tipo, token, doc.nomeArquivo);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao baixar");
    }
  }

  async function onRemover() {
    if (!doc) return;
    if (!confirm(`Remover ${ROTULO_DOCUMENTO_MOTORISTA[tipo]}?`)) return;
    try {
      await remover.mutateAsync(tipo);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao remover");
    }
  }

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-start gap-3">
        <StatusIcon status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm">{ROTULO_DOCUMENTO_MOTORISTA[tipo]}</p>
            <StatusBadge status={status} validade={doc?.validade ?? null} />
          </div>
          {doc ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={doc.nomeArquivo}>
              {doc.nomeArquivo} · {formatTamanho(doc.tamanho)}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Nenhum arquivo anexado</p>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {doc && (
              <label className="space-y-0.5">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                  Validade
                </span>
                <Input
                  type="date"
                  value={validadeLocal}
                  onChange={(e) => setValidadeLocal(e.target.value)}
                  onBlur={onValidadeBlur}
                  className="h-8 w-[150px] text-xs"
                />
              </label>
            )}
            <div className="ml-auto flex gap-1">
              {doc && (
                <Button type="button" variant="ghost" size="sm" onClick={onBaixar}>
                  <Download className="h-3.5 w-3.5" />
                  <span className="ml-1">Baixar</span>
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                <span className="ml-1">{doc ? "Substituir" : "Anexar"}</span>
              </Button>
              {doc && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onRemover}
                  disabled={remover.isPending}
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={onPick}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: DocumentoStatus }) {
  if (status === "OK") return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />;
  if (status === "A_VENCER") return <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />;
  if (status === "VENCIDO") return <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />;
  return <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />;
}

function StatusBadge({ status, validade }: { status: DocumentoStatus; validade: string | null }) {
  if (status === "FALTANDO") {
    return <span className="text-xs text-muted-foreground">Faltando</span>;
  }
  if (status === "OK") {
    if (!validade) return <span className="text-xs text-emerald-700">OK</span>;
    return <span className="text-xs text-emerald-700">Vence {formatBR(validade)}</span>;
  }
  if (status === "A_VENCER") {
    const dias = diasParaVencer(validade);
    return (
      <span className="text-xs text-amber-700">
        {dias === 0 ? "Vence hoje" : `Vence em ${dias}d`}
      </span>
    );
  }
  const dias = diasParaVencer(validade);
  return (
    <span className="text-xs text-red-700">
      Vencido{dias != null ? ` há ${Math.abs(dias)}d` : ""}
    </span>
  );
}

function formatTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
