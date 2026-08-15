"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { ViagemForm, type ViagemEditavel } from "../../_components/viagem-form";

export default function EditarViagemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<ViagemEditavel>("/admin/viagens", id);

  return (
    <div className="space-y-6">
      <FormPageHeader
        // Diária não tem ticket — sem o fallback o título vira "Editar viagem null".
        title={item.data?.ticket ? `Editar viagem ${item.data.ticket}` : "Editar viagem"}
        backHref="/viagens"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && (item.data.matchesFechamento?.length ?? 0) > 0 && (
        <p className="text-sm text-destructive">
          Esta viagem está vinculada a fechamento e não pode ser editada. Desfaça o
          match primeiro.
        </p>
      )}
      {item.data && (item.data.matchesFechamento?.length ?? 0) === 0 && (
        <ViagemForm initial={item.data} />
      )}
    </div>
  );
}
