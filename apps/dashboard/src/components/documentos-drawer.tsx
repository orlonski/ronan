"use client";

import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  ROTULO_DOCUMENTO_MOTORISTA,
  TIPOS_DOCUMENTO_MOTORISTA,
  type MotoristaDocumentoOutput,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { DocumentoRow } from "@/components/documento-row";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuthToken } from "@/lib/client-api";
import {
  baixarZipDocumentos,
  useDocumentosMotorista,
} from "@/lib/motorista-documentos-api";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onClose: () => void;
  motoristaId: string;
  motoristaNome: string;
};

export function DocumentosDrawer({ open, onClose, motoristaId, motoristaNome }: Props) {
  // `enabled` no useQuery já depende do motoristaId, mas o Sheet pode montar
  // antes de abrir; carregar só quando abre evita request pra cada linha da
  // tabela ao montar a página.
  const { data: docs, isLoading } = useDocumentosMotorista(open ? motoristaId : undefined);
  const token = useAuthToken();
  const [baixandoZip, setBaixandoZip] = useState(false);

  /**
   * O que a lista mostra, e por quê nesta ordem.
   *
   * ⚠️ A tela iterava as 12 gavetas e pegava `porTipo.get(tipo)`. Isso parou de
   * funcionar quando duas exigências passaram a poder cair na mesma gaveta: a
   * segunda ficava invisível no painel, embora o arquivo estivesse lá. Então:
   * primeiro TODO arquivo que existe (cada um com o nome que o contratante
   * deu), depois as gavetas que continuam vazias — que é como se anexa um
   * documento avulso.
   */
  const linhas = useMemo(() => {
    const existentes = docs ?? [];
    const comArquivo = existentes.map((d) => ({
      chave: d.chave || `gaveta:${d.tipo}`,
      tipo: d.tipo,
      doc: d as MotoristaDocumentoOutput,
    }));
    const gavetasOcupadas = new Set(existentes.map((d) => d.tipo));
    const vazias = TIPOS_DOCUMENTO_MOTORISTA.filter((t) => !gavetasOcupadas.has(t)).map((t) => ({
      chave: `gaveta:${t}`,
      tipo: t as TipoDocumentoMotorista,
      doc: undefined,
    }));
    return [...comArquivo, ...vazias];
  }, [docs]);

  const temAlgum = (docs?.length ?? 0) > 0;

  async function onBaixarZip() {
    if (!token) return;
    setBaixandoZip(true);
    try {
      await baixarZipDocumentos(motoristaId, token, `documentos-${motoristaNome}.zip`);
    } catch (err) {
      toast.error("Não consegui baixar os documentos", {
        description: err instanceof Error ? err.message : "Tente de novo em alguns instantes.",
      });
    } finally {
      setBaixandoZip(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <div className="border-b p-6">
            <SheetHeader>
              <SheetTitle className="truncate">Documentos · {motoristaNome}</SheetTitle>
              <SheetDescription>
                Anexe, visualize e gerencie os documentos do motorista.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onBaixarZip}
                disabled={!temAlgum || baixandoZip}
                title={temAlgum ? "Baixar todos em zip" : "Nenhum documento anexado"}
              >
                {baixandoZip ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span className="ml-1">Baixar zip</span>
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
              <p className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                Carregando documentos…
              </p>
            ) : (
              <div className="space-y-2">
                {linhas.map((l) => (
                  <DocumentoRow
                    key={l.chave}
                    motoristaId={motoristaId}
                    tipo={l.tipo}
                    doc={l.doc}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Wrapper de ícone que abre o drawer. Mantém o estado de aberto isolado pra
 * cada linha da tabela sem precisar de provider global.
 */
export function DocumentosDrawerButton({
  motoristaId,
  motoristaNome,
  children,
}: {
  motoristaId: string;
  motoristaNome: string;
  children: (open: () => void) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      {children(() => setAberto(true))}
      <DocumentosDrawer
        open={aberto}
        onClose={() => setAberto(false)}
        motoristaId={motoristaId}
        motoristaNome={motoristaNome}
      />
    </>
  );
}
