"use client";

import { use } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { FormPageHeader } from "@/components/form-page-header";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { CampoLayoutForm, type Campo } from "../_components/campo-layout-form";

const PATH = "/admin/campos-layout";

export default function EditarCampoLayoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session } = useSession();
  const token = useAuthToken();

  const list = useQuery({
    queryKey: [PATH, token],
    enabled: !!token,
    queryFn: () => fetchApi<Campo[]>(PATH, { token }),
  });

  if (session?.user?.perfil !== "ADMIN") {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">Acesso restrito a administradores.</p>
      </div>
    );
  }

  const campo = list.data?.find((c) => c.id === id);

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={campo ? `Editar "${campo.label}"` : "Editar campo de layout"}
        backHref="/configuracoes/campos-layout"
      />
      {list.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {!list.isLoading && !campo && (
        <p className="text-sm text-destructive">Campo não encontrado.</p>
      )}
      {campo && <CampoLayoutForm initial={campo} />}
    </div>
  );
}
