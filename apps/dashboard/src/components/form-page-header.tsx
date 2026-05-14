"use client";

import Link, { type LinkProps } from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  description?: string;
  backHref: LinkProps<string>["href"];
  /** Render extra à direita (ex: badge "Sistema" no campo-layout, status, etc). */
  right?: React.ReactNode;
};

export function FormPageHeader({ title, description, backHref, right }: Props) {
  return (
    <header className="flex items-center gap-3">
      <Link href={backHref}>
        <Button variant="ghost" size="icon" title="Voltar" aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </Link>
      <div className="flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}
