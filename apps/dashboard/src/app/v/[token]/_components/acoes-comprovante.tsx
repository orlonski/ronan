"use client";

import { Printer } from "lucide-react";

/** Salvar/imprimir o comprovante — o cliente costuma anexar no processo dele. */
export function AcoesComprovante() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 print:hidden"
    >
      <Printer className="h-4 w-4" />
      Imprimir / Salvar PDF
    </button>
  );
}
