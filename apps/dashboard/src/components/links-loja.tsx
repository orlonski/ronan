"use client";

import { Copy, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { storeUrls } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";

/**
 * Onde o motorista baixa o app, e o recado pronto pra colar no WhatsApp dele.
 *
 * Vive em componente próprio porque aparece em três lugares: no passo do
 * checklist, na chegada e em /comecar. O painel inteiro não tinha um link pra
 * loja — o teste corria enquanto o dono esperava alguém instalar um app que
 * ninguém disse onde achar.
 */
export function LinksLoja({ recuado = false }: { recuado?: boolean }) {
  const android = storeUrls("android").web;
  const ios = storeUrls("ios").web;

  async function copiar() {
    const texto = `Baixe o app da Movatruck pra lançar as viagens:\nAndroid: ${android}\niPhone: ${ios}`;
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Link copiado. Cole no WhatsApp do motorista.");
    } catch {
      toast.error("Não consegui copiar", { description: "Copie o endereço da barra da loja." });
    }
  }

  return (
    <div
      className={
        recuado
          ? "ml-10 mt-1 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3"
          : "flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3"
      }
    >
      <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <Button variant="outline" size="sm" asChild>
        <a href={android} target="_blank" rel="noreferrer">
          Google Play
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href={ios} target="_blank" rel="noreferrer">
          App Store
        </a>
      </Button>
      <Button variant="default" size="sm" onClick={() => void copiar()} className="gap-1.5">
        <Copy className="h-3.5 w-3.5" aria-hidden />
        Copiar link pro motorista
      </Button>
    </div>
  );
}
