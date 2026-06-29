"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { CampoLayoutForm, type Campo } from "../_components/campo-layout-form";

export default function EditarCampoLayoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Campo>("/admin/campos-layout", id);
  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar "${item.data.label}"` : "Editar campo de layout"}
        backHref="/configuracoes/campos-layout"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && <CampoLayoutForm initial={item.data} />}
    </div>
  );
}
