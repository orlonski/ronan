"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { OrcamentoForm } from "../_components/orcamento-form";

export default function NovoOrcamentoPage() {
  return (
    <RequerTela chave="orcamentos.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo orçamento"
          description="A proposta pro cliente. Nada sai daqui sozinho: você manda o link ou o PDF quando quiser."
          backHref="/orcamentos"
        />
        <OrcamentoForm />
      </div>
    </RequerTela>
  );
}
