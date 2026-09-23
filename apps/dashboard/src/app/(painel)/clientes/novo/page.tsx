"use client";

import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { ClienteForm } from "../_components/cliente-form";

export default function NovoClientePage() {
  // Vindo da página de um cliente (?cliente=<id>), a obra já nasce nele e o
  // salvar volta pra lá — é onde as obras moram agora.
  const cliente = useSearchParams().get("cliente") ?? undefined;
  const voltar = (cliente ? `/empresas/${cliente}` : "/clientes") as Route;
  return (
    <RequerTela chave="clientes.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Nova obra"
          description="Onde se trabalha, vinculada a um cliente."
          backHref={voltar}
        />
        <ClienteForm empresaIdInicial={cliente} voltarPara={voltar} />
      </div>
    </RequerTela>
  );
}
