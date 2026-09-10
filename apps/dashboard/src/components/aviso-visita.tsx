"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { trocarConta } from "@/lib/troca-conta";

/**
 * A faixa que avisa, o tempo todo, que você não está na sua empresa.
 *
 * Não é enfeite: quem entra numa empresa pra dar suporte enxerga o painel
 * inteiro dela, com os mesmos botões de sempre — inclusive os de excluir. O
 * único jeito de saber onde você está é a tela dizer. Âmbar porque é o aviso de
 * cuidado do padrão de botões (verde confirma, vermelho apaga, âmbar é atenção),
 * e ela fica grudada no topo junto do cabeçalho, de modo que rolar a página não
 * some com o aviso.
 */
export function AvisoVisita() {
  const { assumida, conta, contaOrigem } = usePermissoes();
  const token = useAuthToken();
  const [saindo, setSaindo] = useState(false);

  if (!assumida) return null;

  async function sair() {
    setSaindo(true);
    try {
      // Sem `finally`: no sucesso a página recarrega e o spinner some com ela.
      await trocarConta(token, null);
    } catch (e) {
      setSaindo(false);
      toast.error(e instanceof Error ? e.message : "Não consegui sair desta empresa.");
    }
  }

  return (
    <div
      role="status"
      // Fundo OPACO, não `bg-amber-500/15`: a faixa fica grudada no topo e o
      // conteúdo da página passa por baixo dela — com fundo translúcido o texto
      // do aviso se mistura com o que está rolando atrás e vira ilegível.
      className="flex items-center gap-x-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {/* No celular a frase inteira ocupava cinco linhas e comia metade da tela.
          O aviso curto diz o essencial — em qual empresa você está — e o resto
          só aparece onde há largura pra isso. */}
      <p className="min-w-0 flex-1 truncate md:whitespace-normal">
        <span className="md:hidden">
          Suporte em <strong className="font-semibold">{conta?.nome}</strong>
        </span>
        <span className="hidden md:inline">
          Você está em <strong className="font-semibold">{conta?.nome}</strong> como suporte da
          plataforma. Tudo que fizer aqui vale para essa empresa.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => void sair()}
        disabled={saindo}
      >
        {saindo && <Loader2 className="h-4 w-4 animate-spin" />}
        <span className="md:hidden">Sair</span>
        <span className="hidden md:inline">
          Voltar para {contaOrigem?.nome ?? "minha empresa"}
        </span>
      </Button>
    </div>
  );
}
