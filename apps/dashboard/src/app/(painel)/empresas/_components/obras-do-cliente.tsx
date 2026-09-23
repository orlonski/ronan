"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Obra = { id: string; nome: string; ativa: boolean };

/**
 * AS OBRAS DESTE CLIENTE, dentro da página dele.
 *
 * O menu tinha "Clientes" e "Obras" lado a lado, e em 33 de 34 casos a obra
 * era o mesmo nome digitado de novo. Aqui a camada só aparece quando conta:
 * - nenhuma obra: o motorista não vê este cliente no app — diz isso e oferece
 *   criar a obra com o mesmo nome;
 * - uma obra com o nome do cliente: uma linha só, dizendo como o motorista vê;
 * - o resto (nome diferente, várias obras, como a Dromos): a lista.
 */
export function ObrasDoCliente({ clienteId, nomeCliente }: { clienteId: string; nomeCliente: string }) {
  const { temPermissao } = usePermissoes();
  const token = useAuthToken();
  const qc = useQueryClient();
  const path = `/admin/clientes?empresaId=${clienteId}&pageSize=100`;
  const obras = useApiQuery<{ data: Obra[] }>(temPermissao("clientes.ver") ? path : undefined);

  if (!temPermissao("clientes.ver") || !obras.data) return null;
  const lista = obras.data.data;
  const podeCriar = temPermissao("clientes.criar");
  const novaObra = `/clientes/novo?cliente=${clienteId}` as const;

  async function criarComMesmoNome() {
    try {
      await fetchApi("/admin/clientes", {
        method: "POST",
        token,
        body: JSON.stringify({ nome: nomeCliente, empresaId: clienteId }),
      });
      toast.success("Pronto: o motorista já pode escolher este cliente no app.");
      void qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const unicaIgual = lista.length === 1 && lista[0]!.nome === nomeCliente;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Obras</h2>
          <p className="text-sm text-muted-foreground">
            Onde se trabalha. É o que o motorista escolhe no app.
          </p>
        </div>
        {podeCriar && lista.length > 0 && (
          <Link href={novaObra}>
            <Button variant="outline" size="sm">
              <Plus className="mr-1 h-4 w-4" />
              {unicaIgual ? "Adicionar outra obra" : "Nova obra"}
            </Button>
          </Link>
        )}
      </div>

      {lista.length === 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">
            Nenhuma obra ainda: <strong>o motorista não vê este cliente no app</strong>.
          </p>
          {podeCriar && (
            <Button size="sm" onClick={() => void criarComMesmoNome()}>
              Criar a obra “{nomeCliente}”
            </Button>
          )}
        </div>
      )}

      {unicaIgual && (
        <p className="mt-3 text-sm">
          No app, o motorista vê este cliente como <strong>{lista[0]!.nome}</strong>.
          {!lista[0]!.ativa && <span className="text-muted-foreground"> (inativa: some do app)</span>}
          {temPermissao("clientes.editar") && (
            <>
              {" "}
              <Link href={`/clientes/${lista[0]!.id}`} className="text-primary underline">
                Apelidos e dados da obra
              </Link>
            </>
          )}
        </p>
      )}

      {lista.length > 0 && !unicaIgual && (
        <div className="mt-3 divide-y divide-border rounded-md border border-border">
          {lista.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm font-medium">
                {o.nome}
                {!o.ativa && (
                  <Badge className="ml-2 border-border text-muted-foreground">Inativa</Badge>
                )}
              </span>
              {temPermissao("clientes.editar") && (
                <Link href={`/clientes/${o.id}`} className="text-sm text-primary underline">
                  Editar
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
