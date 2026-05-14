"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { LocalForm } from "../_components/local-form";

export default function NovoLocalPage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo local"
        description="Local de carga ou descarga."
        backHref="/locais"
      />
      <LocalForm />
    </div>
  );
}
