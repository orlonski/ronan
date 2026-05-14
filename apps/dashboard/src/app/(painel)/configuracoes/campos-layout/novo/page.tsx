"use client";

import { useSession } from "next-auth/react";
import { FormPageHeader } from "@/components/form-page-header";
import { CampoLayoutForm } from "../_components/campo-layout-form";

export default function NovoCampoLayoutPage() {
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
        title="Novo campo de layout"
        description="Campo que a IA reconhece em planilhas de fechamento."
        backHref="/configuracoes/campos-layout"
      />
      <CampoLayoutForm />
    </div>
  );
}
