"use client";

import { use, useState } from "react";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { Button } from "@/components/ui/button";
import { useResourceItem } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { VeiculoForm, type Veiculo } from "../_components/veiculo-form";
import { ProntuarioDoCaminhao } from "./prontuario";

/**
 * A página do caminhão: o PRONTUÁRIO em cima (km, custo, revisões, linha do
 * tempo) e o cadastro atrás de "Editar dados". Era só o formulário — 29 linhas
 * — e a pergunta "como está o ABC-1234?" não tinha onde ser respondida.
 *
 * Quem não vê manutenção (ou a empresa não contratou) continua vendo só o
 * cadastro, como antes.
 */
export default function VeiculoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const item = useResourceItem<Veiculo>("/admin/veiculos", id);
  const { temPermissao, temModulo } = usePermissoes();
  const verProntuario = temPermissao("manutencao.ver") && temModulo("manutencao.ver");
  const podeEditar = temPermissao("veiculos.editar");
  const [editando, setEditando] = useState(false);

  const titulo = item.data
    ? [item.data.placa, (item.data as { modelo?: string | null }).modelo].filter(Boolean).join(" · ")
    : "Caminhão";

  return (
    <RequerTela chave="veiculos.ver">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <FormPageHeader title={titulo} backHref="/veiculos" />
          {verProntuario && podeEditar && (
            <Button variant="outline" size="sm" onClick={() => setEditando((v) => !v)}>
              {editando ? "Fechar edição" : "Editar dados"}
            </Button>
          )}
        </div>
        {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {item.data && (!verProntuario || editando) && podeEditar && <VeiculoForm initial={item.data} />}
        {verProntuario && <ProntuarioDoCaminhao veiculoId={id} />}
      </div>
    </RequerTela>
  );
}
