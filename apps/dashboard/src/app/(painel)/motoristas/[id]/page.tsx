"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { MotoristaForm, type Motorista } from "../_components/motorista-form";

export default function EditarMotoristaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Motorista>("/admin/motoristas", id);

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar ${item.data.nome}` : "Editar motorista"}
        backHref="/motoristas"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && <MotoristaForm initial={item.data} />}
    </div>
  );
}
