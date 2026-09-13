"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { PedidoForm } from "../_components/pedido-form";

export default function NovoPedidoPage() {
  return (
    <RequerTela chave="pedidos.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo pedido"
          description="O que o cliente combinou. O saldo é calculado a partir das viagens que casarem com ele."
          backHref="/pedidos"
        />
        <PedidoForm />
      </div>
    </RequerTela>
  );
}
