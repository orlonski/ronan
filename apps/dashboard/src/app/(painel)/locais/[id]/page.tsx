"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { LocalForm, type Local } from "../_components/local-form";

export default function EditarLocalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Local>("/admin/locais", id);

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar ${item.data.nome}` : "Editar local"}
        backHref="/locais"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && <LocalForm initial={item.data} />}
    </div>
  );
}
