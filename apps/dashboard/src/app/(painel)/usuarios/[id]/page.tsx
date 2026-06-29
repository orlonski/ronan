"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { UsuarioForm, type User } from "../_components/usuario-form";

export default function EditarUsuarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<User>("/admin/users", id);
  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar ${item.data.nome}` : "Editar usuário"}
        backHref="/usuarios"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && <UsuarioForm initial={item.data} />}
    </div>
  );
}
