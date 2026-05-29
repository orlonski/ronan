"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { AbastecimentoForm, type AbastecimentoEditavel } from "../../_components/abastecimento-form";

export default function EditarAbastecimentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<AbastecimentoEditavel>("/admin/abastecimentos", id);

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar abastecimento` : "Editar abastecimento"}
        backHref="/abastecimentos"
      />
      {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {item.data && <AbastecimentoForm initial={item.data} />}
    </div>
  );
}
