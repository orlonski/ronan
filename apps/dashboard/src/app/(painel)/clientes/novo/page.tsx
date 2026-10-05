"use client";

import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { ClienteForm } from "../_components/cliente-form";

export default function NovoClientePage() {
  // Vindo da página de um cliente (?cliente=<id>), a obra já nasce nele e o
  // salvar volta pra lá — é onde as obras moram agora.
  const params = useSearchParams();
  const cliente = params.get("cliente") ?? undefined;
  // Vindo do de/para da conferência (?nome=…&voltar=/viagens/<id>): nasce com
  // o nome do papel e volta pra viagem ao salvar.
  const voltar = (destinoInterno(params.get("voltar")) ??
    (cliente ? `/empresas/${cliente}` : "/clientes")) as Route;
  return (
    <RequerTela chave="clientes.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Nova obra"
          description="Onde se trabalha, vinculada a um cliente."
          backHref={voltar}
        />
        <ClienteForm
          empresaIdInicial={cliente}
          nomeInicial={params.get("nome") ?? undefined}
          voltarPara={voltar}
        />
      </div>
    </RequerTela>
  );
}

/** Só caminho interno do painel — nunca um link pra fora. */
function destinoInterno(v: string | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
}
