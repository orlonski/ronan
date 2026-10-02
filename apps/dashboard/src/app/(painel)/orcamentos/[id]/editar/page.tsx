"use client";

import { use } from "react";
import type { Route } from "next";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem } from "@/lib/client-api";
import { OrcamentoForm } from "../../_components/orcamento-form";
import type { Orcamento } from "../../_components/tipos";

export default function EditarOrcamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const item = useResourceItem<Orcamento>("/admin/orcamentos", id);

  return (
    <RequerTela chave="orcamentos.editar">
      <div className="space-y-6">
        <FormPageHeader
          title={item.data ? `Orçamento #${item.data.numero}` : "Orçamento"}
          description={
            item.data?.status === "VENCIDO"
              ? "Esta proposta venceu. Coloque uma validade nova pra ela voltar a valer."
              : undefined
          }
          backHref={`/orcamentos/${id}` as Route}
        />
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && <OrcamentoForm initial={item.data} />}
      </div>
    </RequerTela>
  );
}
