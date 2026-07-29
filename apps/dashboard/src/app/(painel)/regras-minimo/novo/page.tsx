"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { RegraForm } from "../_components/regra-form";

export default function NovaRegraMinimoPage() {
  return (
    <RequerTela chave="regras-minimo.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Nova regra de mínimo"
          description="Mínimo faturado por empresa, material e faixa de km rodado."
          backHref="/regras-minimo"
        />
        <RegraForm />
      </div>
    </RequerTela>
  );
}
