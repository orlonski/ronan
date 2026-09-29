"use client";

import Link, { type LinkProps } from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/cabecalho";

type Props = {
  title: string;
  description?: string;
  backHref: LinkProps<string>["href"];
  /** Render extra à direita (ex: badge "Sistema" no campo-layout, status, etc). */
  right?: React.ReactNode;
};

export function FormPageHeader({ title, description, backHref, right }: Props) {
  // Celular: o título e o Voltar sobem pro cabeçalho do shell (cabecalho-mobile),
  // e aqui ficam só a descrição e o `right`. Desktop: tudo como sempre foi.
  usePageTitle(title, typeof backHref === "string" ? backHref : null);
  return (
    <header className="flex items-center gap-3">
      <Button variant="ghost" size="icon" title="Voltar" aria-label="Voltar" asChild className="max-md:hidden">
          <Link href={backHref}>
          <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
      <div className="flex-1">
        <h1 className="text-2xl font-semibold tracking-tight max-md:sr-only">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}
