"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { TipoServicoForm } from "../_components/tipo-servico-form";

export default function NovoTipoServicoPage() {
  return (
    <RequerTela chave="tipos-servico.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo modo de serviço"
          description="Como a viagem é medida e o que o app pede ao motorista."
          backHref="/tipos-servico"
        />
        <TipoServicoForm />
      </div>
    </RequerTela>
  );
}
