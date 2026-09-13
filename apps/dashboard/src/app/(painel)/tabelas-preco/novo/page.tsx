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
          description="Quanto esta empresa paga por tonelada, km, viagem ou diária."
          backHref="/tabelas-preco"
        />
        <PrecoForm />
      </div>
    </RequerTela>
  );
}
