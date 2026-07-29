"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { VeiculoForm, type Veiculo } from "../_components/veiculo-form";

export default function EditarVeiculoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Veiculo>("/admin/veiculos", id);

  return (
    <RequerTela chave="veiculos.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.placa}` : "Editar veículo"}
          backHref="/veiculos"
        />
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && <VeiculoForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
