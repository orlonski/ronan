"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { PrecoForm, type Preco } from "../_components/preco-form";

export default function EditarPrecoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const item = useResourceItem<Preco>("/admin/tabelas-preco", id);

  return (
    <RequerTela chave="tabelas-preco.editar">
      <div className="space-y-6">
        <FormPageHeader
          title="Editar preço"
          description="Mudar o preço reprecifica as viagens do cliente que estão dentro da vigência."
          backHref="/tabelas-preco"
        />
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && <PrecoForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
