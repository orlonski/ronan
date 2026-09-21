"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, Download, Eye, Loader2, PenLine, Trash2, Upload } from "lucide-react";
import {
  ROTULO_DOCUMENTO_MOTORISTA,
  type AssinaturaDocumentoOutput,
  type MotoristaDocumentoOutput,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { usePermissoes } from "@/lib/permissoes";
import { Input } from "@/components/ui/input";
import { PreviewDocumentoModal } from "@/components/preview-documento-modal";
import { useAuthToken } from "@/lib/client-api";
import {
  baixarDocumento,
  useAtualizarValidadeDocumento,
  useRemoverDocumento,
  useUploadDocumento,
} from "@/lib/motorista-documentos-api";
import {
  diasParaVencer,
  formatValidadeBR,
  statusDocumento,
  type DocumentoStatus,
} from "@/lib/documento-status";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";

type Props = {
  motoristaId: string;
  tipo: TipoDocumentoMotorista;
  doc: MotoristaDocumentoOutput | undefined;
};

export function DocumentoRow({ motoristaId, tipo, doc }: Props) {
  /**
   * Como esta linha aponta pro arquivo dela.
   *
   * Com arquivo, é a `chave` dele — duas exigências podem cair na mesma
   * gaveta, e mandar pela gaveta pegaria o documento errado. Sem arquivo, é a
   * própria gaveta: é assim que se anexa um avulso.
   */
  const alvo = doc?.chave ?? tipo;
  const { confirmar, ConfirmDialog } = useConfirm();
  // Anexar/remover documento do motorista (CNH, CRLV) segue
  // `motoristas.documentos` — é PII, não é leitura.
  const { temPermissao } = usePermissoes();
  const podeGerenciar = temPermissao("motoristas.documentos");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const upload = useUploadDocumento(motoristaId);
  const atualizarValidade = useAtualizarValidadeDocumento(motoristaId);
  const remover = useRemoverDocumento(motoristaId);
  const token = useAuthToken();

  // Buffer local pra evitar mandar PATCH a cada keystroke do <input type="date">.
  // Só commita no blur, e ressincroniza quando o servidor atualiza doc.validade.
  // slice(0,10) defende contra eventual ISO completo vindo do backend (input
  // type="date" só aceita YYYY-MM-DD).
  const [validadeLocal, setValidadeLocal] = useState((doc?.validade ?? "").slice(0, 10));
  useEffect(() => {
    setValidadeLocal((doc?.validade ?? "").slice(0, 10));
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
      toast.error("Não consegui enviar o arquivo", {
        description: err instanceof Error ? err.message : "Confira o arquivo e tente de novo.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onValidadeBlur() {
    if (!doc) return;
    const atual = (doc.validade ?? "").slice(0, 10);
    if (validadeLocal === atual) return;
    try {
      await atualizarValidade.mutateAsync({ alvo, validade: validadeLocal || null });
    } catch (err) {
      toast.error("Não consegui salvar a validade", {
        description: err instanceof Error ? err.message : "Tente de novo em alguns instantes.",
      });
    }
  }

  async function onBaixar() {
    if (!doc || !token) return;
    try {
      await baixarDocumento(motoristaId, alvo, token, doc.nomeArquivo);
    } catch (err) {
      toast.error("Não consegui baixar o arquivo", {
        description: err instanceof Error ? err.message : "Tente de novo em alguns instantes.",
      });
    }
  }

  async function onRemover() {
    if (!doc) return;
    const ok = await confirmar({
      variant: "destructive",
      title: `Remover ${doc.titulo ?? ROTULO_DOCUMENTO_MOTORISTA[tipo]}?`,
      description: "O arquivo sai do cadastro do motorista. Dá pra enviar de novo depois.",
      confirmLabel: "Remover documento",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      await remover.mutateAsync(alvo);
    } catch (err) {
      toast.error("Não consegui remover o documento", {
        description: err instanceof Error ? err.message : "Tente de novo em alguns instantes.",
      });
    }
  }

  return (
    <div className="rounded-md border bg-background p-3">
      <ConfirmDialog />
      <div className="flex items-start gap-3">
        <StatusIcon status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm">
              {/* O nome que o CONTRATANTE deu vence o rótulo da gaveta: com
                  RG e CTPS na mesma gaveta, "Registro do motorista" nas duas
                  linhas não diz qual é qual. */}
              {doc?.titulo ?? ROTULO_DOCUMENTO_MOTORISTA[tipo]}
              {doc?.titulo && (
                <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                  {ROTULO_DOCUMENTO_MOTORISTA[tipo]}
                </span>
              )}
            </p>
            <StatusBadge status={status} validade={doc?.validade ?? null} />
          </div>
          {doc ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={doc.nomeArquivo}>
              {doc.nomeArquivo} · {formatTamanho(doc.tamanho)}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Nenhum arquivo anexado</p>
          )}
          {doc?.assinatura && <TrilhaAssinatura assinatura={doc.assinatura} />}
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
                <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(true)}>
                  <Eye className="h-3.5 w-3.5" />
                  <span className="ml-1">Visualizar</span>
                </Button>
              )}
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
                disabled={busy || !podeGerenciar}
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
                  disabled={remover.isPending || !podeGerenciar}
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
      {doc && preview && (
        <PreviewDocumentoModal
          open={preview}
          onClose={() => setPreview(false)}
          motoristaId={motoristaId}
          tipo={tipo}
          doc={doc}
        />
      )}
    </div>
  );
}

/**
 * A prova do aceite eletrônico.
 *
 * ⚠️ Isto já vinha da API e o painel jogava fora: o tipo do documento não
 * tinha o campo `assinatura`, então nome, CPF, IP, hora e hash — que é o que
 * dá valor jurídico à assinatura simples — não eram exibíveis em lugar nenhum
 * do produto. E `confere` era prometido num comentário do backend e não
 * existia, então um arquivo trocado por fora deixava a tela dizendo "assinado"
 * sobre um papel que ninguém assinou.
 */
function TrilhaAssinatura({ assinatura }: { assinatura: AssinaturaDocumentoOutput }) {
  const quebrada = assinatura.confere === false;
  const desconhecida = assinatura.confere === null;
  return (
    <div
      className={
        quebrada
          ? "mt-2 rounded-md border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/40"
          : "mt-2 rounded-md border bg-muted/40 p-2"
      }
    >
      <div className="flex items-center gap-1.5">
        {quebrada ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
        ) : (
          <PenLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium">
          {quebrada
            ? "A assinatura não confere com o arquivo que está aqui"
            : assinatura.modo === "ICP_BRASIL"
              ? "Assinado com certificado digital"
              : "Assinado eletronicamente"}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {assinatura.nome && <>{assinatura.nome} · </>}
        {assinatura.cpf && <>CPF {assinatura.cpf} · </>}
        {new Date(assinatura.assinadoEm).toLocaleString("pt-BR")}
        {assinatura.ip && <> · IP {assinatura.ip}</>}
      </p>
      <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
        SHA-256 {assinatura.hash}
      </p>
      {quebrada && (
        <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">
          O arquivo foi trocado depois da assinatura. Peça pra assinar de novo — o que está
          guardado agora ninguém assinou.
        </p>
      )}
      {desconhecida && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Documento anterior ao registro do hash: não dá pra conferir se o arquivo é o mesmo.
        </p>
      )}
      {assinatura.aviso && (
        <p className="mt-1 text-[11px] text-muted-foreground">{assinatura.aviso}</p>
      )}
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
    return <span className="text-xs text-emerald-700">Vence {formatValidadeBR(validade)}</span>;
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
