"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { TransportadoraForm } from "../_components/transportadora-form";

export default function NovaTransportadoraPage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Nova transportadora"
        description="Frota dona de caminhões e motoristas."
        backHref="/transportadoras"
      />
      <TransportadoraForm />
    </div>
  );
}
