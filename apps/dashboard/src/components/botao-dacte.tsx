"use client";

import * as React from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthToken } from "@/lib/client-api";

/**
 * Abre o DACTE — o papel que acompanha a carga.
 *
 * Passa por `fetch` com o token e vira blob porque a rota é autenticada: um
 * `<a href>` direto abriria uma aba sem cabeçalho e levaria 401.
 *
 * ABRE em vez de baixar. Quem clica quase sempre quer conferir na tela antes de
 * mandar pra impressora, e forçar download deixa um arquivo na pasta de
 * downloads a cada olhada.
 */
export function BotaoDacte({
  id,
  rotulo = "Ver DACTE",
}: {
  id: string;
  rotulo?: string;
}) {
  const token = useAuthToken();
  const [gerando, setGerando] = React.useState(false);

  const abrir = async () => {
    setGerando(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/admin/cte/${id}/dacte`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // A API explica o motivo (rascunho não tem DACTE, por exemplo) — vale
        // mais que "erro ao gerar".
        const corpo = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(corpo?.message ?? `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank", "noopener");
      // Folga pra aba abrir; sem revogar, cada clique deixaria um PDF preso na
      // memória da página.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui gerar o DACTE.");
    } finally {
      setGerando(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={() => void abrir()} disabled={gerando || !token}>
      <FileText className="mr-1 h-3.5 w-3.5" />
      {gerando ? "Gerando…" : rotulo}
    </Button>
  );
}
