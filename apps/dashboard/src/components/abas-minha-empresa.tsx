"use client";

import { AbasDaTela } from "@/components/abas-da-tela";

/**
 * Minha empresa: dados da transportadora, emissor de CT-e e contrato. As abas
 * (e por que o Contrato não tem permissão) moram em abas-da-tela.tsx.
 */
export function AbasMinhaEmpresa() {
  return <AbasDaTela grupo="minha-empresa" />;
}
