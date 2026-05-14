"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { MaterialForm } from "../_components/material-form";

export default function NovoMaterialPage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo material"
        description="Tipo de material transportado."
        backHref="/materiais"
      />
      <MaterialForm />
    </div>
  );
}
