"use client";

import { use } from "react";
import { useSession } from "next-auth/react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { UsuarioForm, type User } from "../_components/usuario-form";

export default function EditarUsuarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session } = useSession();
  const item = useResourceItem<User>("/admin/users", id);

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
