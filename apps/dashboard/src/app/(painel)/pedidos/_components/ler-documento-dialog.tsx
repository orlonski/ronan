"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { LIMITE_DOCUMENTO_PEDIDO, type ExtrairPedidoResult } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, fetchApi, useAuthToken } from "@/lib/client-api";

const ACEITOS = "application/pdf,image/jpeg,image/png,image/webp";
const MB = LIMITE_DOCUMENTO_PEDIDO.bytes / 1024 / 1024;

/**
 * Solta o PDF/foto do pedido ou cola o e-mail; a IA lê e devolve a sugestão.
 *
 * Nada é salvo aqui: a sugestão volta pra tela de novo pedido, que preenche o
 * formulário de sempre. Se a leitura não estiver disponível (sem chave de IA,
 * fora do ar), o diálogo diz isso e a pessoa segue digitando — o formulário
 * nunca depende da IA.
 */
export function LerDocumentoDialog({
  aberto,
  onFechar,
  onLido,
}: {
  aberto: boolean;
  onFechar: () => void;
  onLido: (r: ExtrairPedidoResult) => void;
}) {
  const token = useAuthToken();
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [texto, setTexto] = useState("");
  const [arrastando, setArrastando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<{ msg: string; indisponivel: boolean } | null>(null);

  function escolher(f: File | null | undefined) {
    setErro(null);
    if (!f) return;
    if (!ACEITOS.split(",").includes(f.type)) {
      setErro({ msg: "Mande um PDF ou uma foto (JPG, PNG ou WebP).", indisponivel: false });
      return;
    }
    if (f.size > LIMITE_DOCUMENTO_PEDIDO.bytes) {
      setErro({ msg: `O arquivo passa de ${MB} MB. Mande só as páginas do pedido.`, indisponivel: false });
      return;
    }
    setArquivo(f);
  }

  async function ler() {
    if (!arquivo && texto.trim().length < 10) {
      setErro({ msg: "Solte o arquivo do pedido ou cole o texto do e-mail.", indisponivel: false });
      return;
    }
    setErro(null);
    setLendo(true);
    try {
      const fd = new FormData();
      if (arquivo) fd.append("arquivo", arquivo);
      if (texto.trim()) fd.append("texto", texto.trim());
      const r = await fetchApi<ExtrairPedidoResult>("/admin/pedidos/extrair", {
        token,
        method: "POST",
        body: fd,
      });
      onLido(r);
      setArquivo(null);
      setTexto("");
    } catch (e) {
      const indisponivel =
        e instanceof ApiError && (e.code === "LEITURA_PEDIDO_INDISPONIVEL" || e.status === 503);
      const msg =
        e instanceof ApiError && e.status === 413
          ? `O arquivo passa de ${MB} MB. Mande só as páginas do pedido.`
          : (e as Error).message || "Não consegui ler o documento.";
      setErro({ msg, indisponivel });
    } finally {
      setLendo(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !lendo && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar pedido a partir de documento</DialogTitle>
          <DialogDescription>
            Solte a ordem de compra (PDF ou foto) ou cole o e-mail do cliente. O sistema preenche o
            pedido pra você conferir — nada é salvo sem você clicar em Salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {arquivo ? (
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{arquivo.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(arquivo.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Tirar arquivo"
                disabled={lendo}
                onClick={() => setArquivo(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="soltar-documento"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastando(false);
                escolher(e.dataTransfer.files?.[0]);
              }}
              className={`flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                arrastando ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
              }`}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">Solte o arquivo aqui ou clique pra escolher</span>
              <span className="text-xs text-muted-foreground">PDF, JPG, PNG ou WebP · até {MB} MB</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACEITOS}
            className="hidden"
            data-testid="arquivo-documento"
            onChange={(e) => {
              escolher(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          <div className="space-y-2">
            <Label htmlFor="pedido-doc-texto">Ou cole o texto do e-mail</Label>
            <Textarea
              id="pedido-doc-texto"
              rows={5}
              maxLength={LIMITE_DOCUMENTO_PEDIDO.caracteresTexto}
              placeholder="Bom dia, precisamos de 20 cargas de brita 1 na obra… a partir de segunda."
              value={texto}
              disabled={lendo}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>

          {erro && (
            <div
              role="alert"
              className={`rounded-md border p-3 text-sm ${
                erro.indisponivel
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-destructive/40 bg-destructive/5 text-destructive"
              }`}
            >
              {erro.msg}
            </div>
          )}
        </div>

        <DialogFooter>
          {erro?.indisponivel ? (
            <Button type="button" variant="outline" onClick={onFechar}>
              Preencher à mão
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onFechar} disabled={lendo}>
              Cancelar
            </Button>
          )}
          <Button type="button" onClick={ler} disabled={lendo || (!arquivo && texto.trim().length < 10)}>
            {lendo ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo o documento…
              </>
            ) : (
              "Ler documento"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
