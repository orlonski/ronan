"use client";

import dynamic from "next/dynamic";
import { Building2 } from "lucide-react";

// O desenho usa canvas e `window`: só roda no navegador.
const EscritorioCliente = dynamic(
  () => import("./_components/escritorio-cliente").then((m) => m.EscritorioCliente),
  { ssr: false, loading: () => <div className="h-[60vh] rounded-lg border bg-muted/30" /> },
);

export default function EscritorioPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Building2 className="h-6 w-6" />
          Escritório de Agentes
        </h1>
        <p className="text-sm text-muted-foreground">
          A viagem sai do celular do motorista, passa pela torre e pelo servidor, cai na mesa de entrada e os
          agentes conferem o ticket.
        </p>
      </header>
      <EscritorioCliente />
    </div>
  );
}
