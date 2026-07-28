"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { VeiculoForm } from "../_components/veiculo-form";

export default function NovoVeiculoPage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo veículo"
        description="Caminhão que roda pra gente."
        backHref="/veiculos"
      />
      <VeiculoForm />
    </div>
  );
}
