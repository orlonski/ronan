"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { MaterialForm } from "../_components/material-form";

export default function NovoMaterialPage() {
  return (
    <RequerTela chave="materiais.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo material"
          description="Tipo de material transportado."
          backHref="/materiais"
        />
        <MaterialForm />
      </div>
    </RequerTela>
  );
}
