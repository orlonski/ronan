"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { EmpresaForm, type Empresa } from "../_components/empresa-form";

export default function EditarEmpresaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Empresa>("/admin/empresas", id);

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar ${item.data.nome}` : "Editar empresa"}
        backHref="/empresas"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && <EmpresaForm initial={item.data} />}
    </div>
  );
}
