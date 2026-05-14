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
    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-2">
        <Link href={backHref}>
          <Button variant="ghost" size="icon" title="Voltar" aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}
