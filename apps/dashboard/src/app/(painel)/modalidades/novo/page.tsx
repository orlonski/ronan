"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { ModalidadeForm } from "../_components/modalidade-form";

export default function NovaModalidadePage() {
  return (
    <RequerTela chave="modalidades.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Nova modalidade"
          description="O vínculo do motorista e o que ele precisa fotografar no abastecimento."
          backHref="/modalidades"
        />
        <ModalidadeForm />
      </div>
    </RequerTela>
  );
}
