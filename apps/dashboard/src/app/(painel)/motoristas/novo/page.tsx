"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { MotoristaForm } from "../_components/motorista-form";

export default function NovoMotoristaPage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo motorista"
        description="Cadastro de motorista com placas e documentos."
        backHref="/motoristas"
      />
      <MotoristaForm />
    </div>
  );
}
