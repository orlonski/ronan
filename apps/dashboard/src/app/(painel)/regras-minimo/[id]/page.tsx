"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { RegraForm, type Regra } from "../_components/regra-form";

export default function EditarRegraMinimoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Regra>("/admin/regras-minimo", id);

  return (
    <div className="space-y-6">
      <FormPageHeader title="Editar regra de mínimo" backHref="/regras-minimo" />
      {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {item.data && <RegraForm initial={item.data} />}
    </div>
  );
}
