"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Convite = {
  id: string;
  token: string;
  expiraEm: string;
  revogadoEm: string | null;
  visualizacoes: number;
  enviosFeitos: number;
  criadoEm: string;
};

const PATH = "/admin/admissao/coletas";

function linkDe(token: string): string {
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}/coleta/${token}`;
}

function dataBr(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * O link que substitui a caçada de documento no WhatsApp.
 *
 * Serve ao dono do caminhão E ao próprio motorista — decisão do dono: um ajuda
 * o outro, e exigir que o motorista instale o app pra mandar a CNH travaria a
 * admissão justo na parte mais frágil.
 *
 * O painel mostra quantas vezes o link foi aberto e quantos arquivos entraram,
 * mas nunca o que foi enviado por ele: quem abre pode não ser o titular dos
 * documentos.
 */
export function PedirDocumentos({ motoristaId }: { motoristaId: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [ultimo, setUltimo] = useState<string | null>(null);

  const convites = useQuery({
    queryKey: [PATH, motoristaId],
    enabled: !!token && temPermissao("coletas.ver"),
    queryFn: () => fetchApi<Convite[]>(`${PATH}?motoristaId=${motoristaId}`, { token }),
  });

  const criar = useMutation({
    mutationFn: () =>
      fetchApi<Convite>(PATH, {
        token,
        method: "POST",
        body: JSON.stringify({ motoristaId }),
      }),
    onSuccess: (c) => {
      setUltimo(linkDe(c.token));
      toast.success("Link criado.", { description: "Copie e mande pra quem vai enviar." });
      void qc.invalidateQueries({ queryKey: [PATH, motoristaId] });
    },
    onError: (e: Error) => toast.error("Não consegui criar o link", { description: e.message }),
  });

  const revogar = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`${PATH}/${id}/revogar`, { token, method: "POST", body: "{}" }),
    onSuccess: () => {
      toast.success("Link revogado.", { description: "Quem tiver a URL não abre mais." });
      void qc.invalidateQueries({ queryKey: [PATH, motoristaId] });
    },
  });

  if (!temPermissao("coletas.ver")) return null;

  const vivos = (convites.data ?? []).filter(
    (c) => !c.revogadoEm && new Date(c.expiraEm).getTime() > Date.now(),
  );

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            Pedir documentos por link
          </p>
          <p className="text-sm text-muted-foreground">
            Abre sem login, no celular. Pode mandar pro motorista ou pro dono do caminhão.
          </p>
        </div>
        {temPermissao("coletas.criar") && (
          <Button variant="outline" disabled={criar.isPending} onClick={() => criar.mutate()}>
            {criar.isPending ? "Criando…" : "Gerar link"}
          </Button>
        )}
      </div>

      {ultimo && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/5 p-3">
          <Input readOnly value={ultimo} className="min-w-0 flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(ultimo);
              toast.success("Link copiado.");
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copiar
          </Button>
        </div>
      )}

      {vivos.length > 0 && (
        <div className="space-y-2">
          {vivos.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
            >
              <span className="text-muted-foreground">
                Criado {dataBr(c.criadoEm)} · vale até {dataBr(c.expiraEm)} ·{" "}
                {c.visualizacoes} abertura(s) · {c.enviosFeitos} arquivo(s)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(linkDe(c.token));
                    toast.success("Link copiado.");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                {temPermissao("coletas.criar") && (
                  <Button variant="outline" size="sm" onClick={() => revogar.mutate(c.id)}>
                    <Ban className="mr-1 h-3.5 w-3.5" />
                    Revogar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* O link é a credencial: quem tiver a URL entra. Dizer isso aqui é mais
          barato que descobrir depois. */}
      <p className="text-xs text-muted-foreground">
        Quem tiver o link consegue enviar documentos deste motorista. Ele vence sozinho em 14
        dias, e dá pra revogar antes.
      </p>
    </Card>
  );
}
