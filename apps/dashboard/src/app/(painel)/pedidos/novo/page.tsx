"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText } from "lucide-react";
import type { ExtrairPedidoResult } from "@ronan/shared-types";
import { FormPageHeader } from "@/components/form-page-header";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { PedidoForm } from "../_components/pedido-form";
import { LerDocumentoDialog } from "../_components/ler-documento-dialog";

export default function NovoPedidoPage() {
  return (
    <RequerTela chave="pedidos.criar">
      <Suspense>
        <Conteudo />
      </Suspense>
    </RequerTela>
  );
}

function Conteudo() {
  // `?documento=1` vem do botão "Criar pedido a partir de documento" da lista:
  // a tela já abre com o diálogo de soltar o arquivo.
  const [dialogo, setDialogo] = useState(useSearchParams().get("documento") === "1");
  const [sugestao, setSugestao] = useState<ExtrairPedidoResult | undefined>();
  // Cada leitura remonta o formulário: o estado dele nasce dos valores lidos.
  const [versao, setVersao] = useState(0);

  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Novo pedido"
        description="O que o cliente combinou. O saldo é calculado a partir das viagens que casarem com ele."
        backHref="/pedidos"
        right={
          <Button type="button" onClick={() => setDialogo(true)}>
            <FileText className="h-4 w-4" /> Ler de um documento
          </Button>
        }
      />
      <PedidoForm key={versao} sugestao={sugestao} />
      <LerDocumentoDialog
        aberto={dialogo}
        onFechar={() => setDialogo(false)}
        onLido={(r) => {
          setSugestao(r);
          setVersao((v) => v + 1);
          setDialogo(false);
        }}
      />
    </div>
  );
}
