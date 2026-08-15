"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { TipoServicoForm, type TipoServico } from "../_components/tipo-servico-form";

export default function EditarTipoServicoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<TipoServico>("/admin/tipos-servico", id);

  return (
    <RequerTela chave="tipos-servico.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar modo de serviço"}
          backHref="/tipos-servico"
        />
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && <TipoServicoForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
