"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { ModalidadeForm, type Modalidade } from "../_components/modalidade-form";

export default function EditarModalidadePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Modalidade>("/admin/modalidades", id);

  return (
    <RequerTela chave="modalidades.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar modalidade"}
          backHref="/modalidades"
        />
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && <ModalidadeForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
