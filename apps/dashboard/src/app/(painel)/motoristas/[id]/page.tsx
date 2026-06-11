"use client";

import { use } from "react";
import { FormPageHeader } from "@/components/form-page-header";
import { useResourceItem, useApiQuery } from "@/lib/client-api";
import {
  AppVersaoCard,
  type AppVersaoInfo,
} from "@/components/app-versao-badge";
import { MotoristaForm, type Motorista } from "../_components/motorista-form";
import { HistoricoNotificacoes } from "./historico-notificacoes";

type ResumoVersoes = { latestUpdateId: string | null };

export default function EditarMotoristaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Motorista & AppVersaoInfo>("/admin/motoristas", id);
  const resumo = useApiQuery<ResumoVersoes>("/admin/motoristas/versoes/resumo", {
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar ${item.data.nome}` : "Editar motorista"}
        backHref="/motoristas"
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && (
        <>
          <AppVersaoCard
            motorista={item.data}
            latestUpdateId={resumo.data?.latestUpdateId ?? null}
          />
          <MotoristaForm initial={item.data} />
          <HistoricoNotificacoes motoristaId={id} />
        </>
      )}
    </div>
  );
}
