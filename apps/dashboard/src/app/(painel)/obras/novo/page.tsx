"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { ObraForm } from "../_components/obra-form";

export default function NovaObraPage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Nova obra"
        description="Local de obra vinculado a uma empresa-cliente."
        backHref="/obras"
      />
      <ObraForm />
    </div>
  );
}
