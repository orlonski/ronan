"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import {
  ROTULO_DOCUMENTO_MOTORISTA,
  type MotoristaDocumentoOutput,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthToken } from "@/lib/client-api";
import {
  baixarDocumento,
  carregarPreviewDocumento,
} from "@/lib/motorista-documentos-api";

type Props = {
  open: boolean;
  onClose: () => void;
  motoristaId: string;
  tipo: TipoDocumentoMotorista;
  doc: MotoristaDocumentoOutput;
};

export function PreviewDocumentoModal({ open, onClose, motoristaId, tipo, doc }: Props) {
  const token = useAuthToken();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mimetype, setMimetype] = useState<string>(doc.mimetype);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    let cancelado = false;
    let urlCriada: string | null = null;
    setCarregando(true);
    setErro(null);
    carregarPreviewDocumento(motoristaId, tipo, token)
      .then(({ url, mimetype: mt }) => {
        if (cancelado) {
          URL.revokeObjectURL(url);
          return;
        }
        urlCriada = url;
        setPreviewUrl(url);
        setMimetype(mt || doc.mimetype);
      })
      .catch((err) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
      setPreviewUrl(null);
    };
  }, [open, motoristaId, tipo, token, doc.mimetype]);

  async function onBaixar() {
    if (!token) return;
    try {
      await baixarDocumento(motoristaId, tipo, token, doc.nomeArquivo);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao baixar");
    }
  }

  const ehImagem = mimetype.startsWith("image/");
  const ehPdf = mimetype === "application/pdf";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-5xl flex-col gap-3 p-4 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">
            {ROTULO_DOCUMENTO_MOTORISTA[tipo]}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {doc.nomeArquivo}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {carregando ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Carregando arquivo…</span>
            </div>
          ) : erro ? (
            <p className="px-4 text-center text-sm text-destructive">{erro}</p>
          ) : previewUrl && ehImagem ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={doc.nomeArquivo}
              className="max-h-full max-w-full object-contain"
            />
          ) : previewUrl && ehPdf ? (
            <iframe
              src={previewUrl}
              title={doc.nomeArquivo}
              className="h-full w-full border-0"
            />
          ) : (
            <p className="px-4 text-center text-sm text-muted-foreground">
              Pré-visualização não disponível pra esse tipo de arquivo. Use o botão Baixar.
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline" size="sm">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="ml-1">Abrir em nova aba</span>
              </Button>
            </a>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onBaixar}>
            <Download className="h-3.5 w-3.5" />
            <span className="ml-1">Baixar</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
