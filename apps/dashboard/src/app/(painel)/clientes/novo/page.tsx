"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { ClienteForm } from "../_components/cliente-form";

export default function NovoClientePage() {
  return (
    <RequerTela chave="clientes.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo cliente"
          description="Cliente vinculado a uma empresa."
          backHref="/clientes"
        />
        <ClienteForm />
      </div>
    </RequerTela>
  );
}
