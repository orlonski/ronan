"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { LocalForm, type Local } from "../_components/local-form";
import { ViagensDoLocal } from "../_components/viagens-do-local";

export default function EditarLocalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Local>("/admin/locais", id);

  return (
    <RequerTela chave="locais.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar local"}
          backHref="/locais"
        />
        {item.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {item.data && (
          <>
            <LocalForm initial={item.data} />
            <ViagensDoLocal localId={id} totalViagens={item.data.totalViagens} />
          </>
        )}
      </div>
    </RequerTela>
  );
}
