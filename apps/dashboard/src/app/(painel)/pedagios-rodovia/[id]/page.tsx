"use client";

import { use } from "react";
import { RequerTela } from "@/components/requer-tela";
import { useRouter } from "next/navigation";
import { FormPageHeader } from "@/components/form-page-header";
import { ExcluirButton } from "@/components/excluir-button";
import { Card } from "@/components/ui/card";
import { useResourceItem } from "@/lib/client-api";
import { PedagioForm, type PedagioRodovia } from "../_components/pedagio-form";

export default function EditarPedagioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const item = useResourceItem<PedagioRodovia>("/admin/pedagios-rodovia", id);

  return (
    <RequerTela chave="pedagios.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Editar ${item.data.nome}` : "Editar pedágio"}
          backHref="/pedagios-rodovia"
        />
        {item.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {item.data && (
          <>
            <PedagioForm initial={item.data} />
            <Card className="flex flex-col gap-3 border-destructive/30 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Excluir pedágio</p>
                <p className="text-xs text-muted-foreground">
                  Remove o pedágio do cadastro. Não afeta viagens já lançadas.
                </p>
              </div>
              <ExcluirButton
                perm="pedagios.excluir"
                path="/admin/pedagios-rodovia"
                id={id}
                nomeRecurso={`o pedágio "${item.data.nome}"`}
                onSuccess={() => router.push("/pedagios-rodovia")}
                variant="destructive"
                size="sm"
                label="Excluir"
              />
            </Card>
          </>
        )}
      </div>
    </RequerTela>
  );
}
