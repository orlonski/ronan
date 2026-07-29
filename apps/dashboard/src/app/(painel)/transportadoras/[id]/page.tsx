"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { TransportadoraForm, type Transportadora } from "../_components/transportadora-form";

export default function EditarTransportadoraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Transportadora>("/admin/transportadoras", id);

  return (
    <RequerTela chave="transportadoras.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar transportadora"}
          backHref="/transportadoras"
        />
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && <TransportadoraForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
