"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

/**
 * A rede contra perder o que foi digitado.
 *
 * Uma busca por `beforeunload`, `isDirty` e `useBlocker` no painel inteiro dava
 * ZERO: "Cancelar" era um <Link> puro e a seta de voltar também, então sair de
 * um cadastro longo pelo menu descartava tudo em silêncio. Pra escritório que
 * digita o dia inteiro, é o erro mais caro da tela.
 *
 * O App Router do Next não expõe um bloqueador de navegação, então a cobertura
 * é feita em duas frentes:
 * - `useAvisarSeSujo` cobre recarregar, fechar a aba e voltar no navegador;
 * - `<BotaoCancelar>` cobre a saída deliberada, que é o caminho comum.
 */

export function useAvisarSeSujo(sujo: boolean) {
  useEffect(() => {
    if (!sujo) return;
    function aviso(e: BeforeUnloadEvent) {
      // O texto é do navegador — não dá pra escolher. O que importa é o gesto
      // existir: sem isso, F5 no meio de um cadastro leva tudo.
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);
}

export function BotaoCancelar({
  href,
  sujo,
  label = "Cancelar",
}: {
  href: string;
  /** Há alteração não salva? Sem isso, sai direto (não há o que perder). */
  sujo: boolean;
  label?: string;
}) {
  const router = useRouter();
  const { confirmar, ConfirmDialog } = useConfirm();

  async function sair() {
    if (sujo) {
      const ok = await confirmar({
        variant: "destructive",
        title: "Sair sem salvar?",
        description: "O que você preencheu nesta tela será perdido.",
        confirmLabel: "Descartar alterações",
        cancelLabel: "Continuar editando",
      });
      if (!ok) return;
    }
    router.push(href as never);
  }

  return (
    <>
      <ConfirmDialog />
      <Button type="button" variant="outline" onClick={() => void sair()}>
        {label}
      </Button>
    </>
  );
}
