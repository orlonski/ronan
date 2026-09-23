"use client";

import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";
import { ROTULO_DOCUMENTO_MOTORISTA, type TipoDocumentoMotorista } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApiQuery } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Exigido = {
  id: string;
  titulo: string;
  tipo: TipoDocumentoMotorista;
  empresaId: string | null;
  obrigatorio: boolean;
  ativo: boolean;
};

/**
 * O QUE ESTE CLIENTE EXIGE de documento antes do caminhão entrar na obra.
 *
 * O cadastro continua sendo um só (Minha empresa › Documentos que pedimos);
 * aqui aparece só o recorte deste cliente, porque é daqui que a pessoa parte
 * quando o cliente liga dizendo "agora exijo também a ordem de serviço". Os
 * links já abrem a tela filtrada (`?cliente=`) — e com o formulário aberto e
 * o cliente escolhido, no caso do botão de criar (`&novo=1`).
 */
export function DocumentosDoCliente({ clienteId }: { clienteId: string }) {
  const { temPermissao, temModulo } = usePermissoes();
  const ve = temPermissao("documentos-exigidos.ver") && temModulo("documentos-exigidos.ver");
  const lista = useApiQuery<Exigido[]>(ve ? "/admin/admissao/documentos-exigidos" : undefined);

  if (!ve) return null;
  const doCliente = (lista.data ?? []).filter((e) => e.ativo && e.empresaId === clienteId);
  const tela = `/documentos-exigidos?cliente=${clienteId}`;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Documentos que este cliente exige</h2>
          <p className="text-sm text-muted-foreground">
            O que ele pede antes do caminhão entrar na obra. Aparece no link de coleta, junto com o
            que a transportadora pede de todo mundo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={tela as Route} className="text-sm text-primary underline">
            Ver na lista completa
          </Link>
          {temPermissao("documentos-exigidos.editar") && (
            <Link href={`${tela}&novo=1` as Route}>
              <Button variant="outline" size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Exigir um documento
              </Button>
            </Link>
          )}
        </div>
      </div>

      {lista.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {lista.data && doCliente.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Nada específico deste cliente: vale só o que a transportadora pede de todo mundo.
        </p>
      )}
      {doCliente.length > 0 && (
        <div className="mt-3 divide-y divide-border rounded-md border border-border">
          {doCliente.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">
                {e.titulo}
                {!e.obrigatorio && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">opcional</span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                guardado em {ROTULO_DOCUMENTO_MOTORISTA[e.tipo] ?? e.tipo}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
