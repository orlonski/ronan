"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { EmpresaForm, type Empresa } from "../_components/empresa-form";
import { ObrasDoCliente } from "../_components/obras-do-cliente";
import { PrecoMinimoDoCliente } from "../_components/preco-minimo-do-cliente";

export default function EditarEmpresaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Empresa>("/admin/empresas", id);

  return (
    <RequerTela chave="empresas.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar cliente"}
          backHref="/empresas"
        />
        {item.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {item.data && <EmpresaForm initial={item.data} />}
        {item.data && <ObrasDoCliente clienteId={item.data.id} nomeCliente={item.data.nome} />}
        {item.data && <PrecoMinimoDoCliente clienteId={item.data.id} />}
      </div>
    </RequerTela>
  );
}
