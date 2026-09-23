"use client";

import { AbasDaTela } from "@/components/abas-da-tela";

/**
 * As duas metades de "Papéis e permissões": o que cada papel faz no PAINEL
 * e o que cada tipo de pessoa vê no APP. As abas moram em abas-da-tela.tsx.
 */
export function AbasPermissoes() {
  return <AbasDaTela grupo="permissoes" />;
}
