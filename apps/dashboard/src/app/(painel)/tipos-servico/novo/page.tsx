"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { TipoServicoForm } from "../_components/tipo-servico-form";

export default function NovoTipoServicoPage() {
  return (
    <RequerTela chave="tipos-servico.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo tipo de viagem"
          description="O que o app pede ao motorista quando ele escolhe este tipo."
          backHref="/tipos-servico"
        />
        <TipoServicoForm />
      </div>
    </RequerTela>
  );
}
