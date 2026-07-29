"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { PedagioForm } from "../_components/pedagio-form";

export default function NovoPedagioPage() {
  return (
    <RequerTela chave="pedagios.criar">
      <div className="space-y-6">
        <FormPageHeader title="Novo pedágio" backHref="/pedagios-rodovia" />
        <PedagioForm />
      </div>
    </RequerTela>
  );
}
