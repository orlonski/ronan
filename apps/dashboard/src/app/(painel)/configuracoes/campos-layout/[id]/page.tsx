"use client";

import { use } from "react";
import { useSession } from "next-auth/react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { CampoLayoutForm, type Campo } from "../_components/campo-layout-form";

export default function EditarCampoLayoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session } = useSession();
  const item = useResourceItem<Campo>("/admin/campos-layout", id);

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
        title={item.data ? `Editar "${item.data.label}"` : "Editar campo de layout"}
        backHref="/configuracoes/campos-layout"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && <CampoLayoutForm initial={item.data} />}
    </div>
  );
}
