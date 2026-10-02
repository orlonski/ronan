"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { ClienteForm, type Cliente } from "../_components/cliente-form";
import { EncarregadosObra } from "../_components/encarregados-obra";

export default function EditarClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Cliente>("/admin/clientes", id);

  return (
    <RequerTela chave="clientes.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar obra"}
          backHref="/clientes"
        />
        {item.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {item.data && <ClienteForm initial={item.data} />}
        {/* Quem da obra acompanha pelo celular. Some sozinho sem a permissão. */}
        {item.data && <EncarregadosObra clienteId={item.data.id} obraNome={item.data.nome} />}
      </div>
    </RequerTela>
  );
}
