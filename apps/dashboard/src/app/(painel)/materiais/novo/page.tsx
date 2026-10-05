"use client";

import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { MaterialForm } from "../_components/material-form";

export default function NovoMaterialPage() {
  // Vindo do de/para da conferência (?nome=…&voltar=/viagens/<id>): nasce com
  // o nome do papel e volta pra viagem ao salvar.
  const params = useSearchParams();
  const voltar = destinoInterno(params.get("voltar")) ?? "/materiais";
  return (
    <RequerTela chave="materiais.criar">
      <div className="space-y-6">
        <FormPageHeader
          title="Novo material"
          description="Tipo de material transportado."
          backHref={voltar as Route}
        />
        <MaterialForm nomeInicial={params.get("nome") ?? undefined} voltarPara={voltar} />
      </div>
    </RequerTela>
  );
}

/** Só caminho interno do painel — nunca um link pra fora. */
function destinoInterno(v: string | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
}
