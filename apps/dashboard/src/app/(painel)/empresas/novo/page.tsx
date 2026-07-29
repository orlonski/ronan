"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { EmpresaForm } from "../_components/empresa-form";

export default function NovaEmpresaPage() {
  return (
    <RequerTela chave="empresas.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Nova empresa"
          description="Empresa pra quem prestamos serviço."
          backHref="/empresas"
        />
        <EmpresaForm />
      </div>
    </RequerTela>
  );
}
