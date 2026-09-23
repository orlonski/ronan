"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { PrecoForm } from "../_components/preco-form";

export default function NovoPrecoPage() {
  return (
    <RequerTela chave="tabelas-preco.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo preço"
          description="Quanto este cliente paga por tonelada, km ou viagem."
          backHref="/tabelas-preco"
        />
        <PrecoForm />
      </div>
    </RequerTela>
  );
}
