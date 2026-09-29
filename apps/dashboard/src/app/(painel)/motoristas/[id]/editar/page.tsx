"use client";

import { use } from "react";
import type { Route } from "next";
import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { useResourceItem, useApiQuery } from "@/lib/client-api";
import { MotoristaForm, type Motorista } from "../../_components/motorista-form";
import type { AcessoDaPessoa } from "../acesso-app-card";

/**
 * EDITAR o motorista. A leitura (ficha, versão do app, calendário, acesso,
 * histórico) mora em `/motoristas/[id]`; aqui só se altera o cadastro.
 * Voltar, salvar e cancelar levam à listagem.
 */
export default function EditarMotoristaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <RequerTela chave="motoristas.editar">
      <Conteudo id={id} />
    </RequerTela>
  );
}

function Conteudo({ id }: { id: string }) {
  const item = useResourceItem<Motorista>("/admin/motoristas", id);
  // Mesma chave do card da ficha: o react-query entrega uma resposta só.
  const acesso = useApiQuery<AcessoDaPessoa>(`/admin/acesso-app/motoristas/${id}`);

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={item.data ? `Editar ${item.data.nome}` : "Editar motorista"}
        backHref={"/motoristas" as Route}
      />
      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {item.data && (
        <MotoristaForm initial={item.data} acessoPorRegras={acesso.data?.fonte === "REGRAS"} />
      )}
    </div>
  );
}
