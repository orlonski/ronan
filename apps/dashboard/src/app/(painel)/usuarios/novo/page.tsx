"use client";

import { FormPageHeader } from "@/components/form-page-header";
import { UsuarioForm } from "../_components/usuario-form";

export default function NovoUsuarioPage() {
  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo usuário"
        description="Quem acessa o painel admin."
        backHref="/usuarios"
      />
      <UsuarioForm />
    </div>
  );
}
