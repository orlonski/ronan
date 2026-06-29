"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { CampoLayoutForm } from "../_components/campo-layout-form";

export default function NovoCampoLayoutPage() {  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo campo de layout"
        description="Campo que a IA reconhece em planilhas de fechamento."
        backHref="/configuracoes/campos-layout"
      />
      <CampoLayoutForm />
    </div>
  );
}
