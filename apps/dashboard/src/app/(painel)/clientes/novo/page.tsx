"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { ClienteForm } from "../_components/cliente-form";

export default function NovoClientePage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo cliente"
        description="Cliente vinculado a uma empresa."
        backHref="/clientes"
      />
      <ClienteForm />
    </div>
  );
}
