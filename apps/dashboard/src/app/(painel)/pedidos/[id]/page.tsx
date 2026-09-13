"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { PedidoForm, type Pedido } from "../_components/pedido-form";

export default function EditarPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const item = useResourceItem<Pedido>("/admin/pedidos", id);

  return (
    <RequerTela chave="pedidos.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Pedido #${item.data.numero}` : "Pedido"}
          backHref="/pedidos"
        />
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && <PedidoForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
