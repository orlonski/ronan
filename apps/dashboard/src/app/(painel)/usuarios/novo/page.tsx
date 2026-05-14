"use client";

import { useSession } from "next-auth/react";
import { FormPageHeader } from "@/components/form-page-header";
import { UsuarioForm } from "../_components/usuario-form";

export default function NovoUsuarioPage() {
  const { data: session } = useSession();
  if (session?.user?.perfil !== "ADMIN") {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">Acesso restrito a administradores.</p>
      </div>
    );
  }
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
