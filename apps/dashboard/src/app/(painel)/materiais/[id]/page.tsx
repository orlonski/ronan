"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { MaterialForm, type Material } from "../_components/material-form";

export default function EditarMaterialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Material>("/admin/materiais", id);

  return (
    <RequerTela chave="materiais.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar material"}
          backHref="/materiais"
        />
        {item.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {item.data && <MaterialForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
