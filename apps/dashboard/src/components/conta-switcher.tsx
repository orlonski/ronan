"use client";

import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Home, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { trocarConta } from "@/lib/troca-conta";
import { cn } from "@/lib/utils";

type ContaItem = { id: string; nome: string; ativa: boolean };

/**
 * Seletor de empresa da equipe da plataforma.
 *
 * Só aparece pra quem tem `plataforma` — o mesmo portão que esconde a tela de
 * Empresas, e que o backend cobra de novo no `PlataformaGuard`. Pra todo mundo
 * mais este componente não desenha nada, nem consulta a lista.
 */
export function ContaSwitcher() {
  const { plataforma, conta, assumida, contaOrigem } = usePermissoes();
  const token = useAuthToken();
  const [trocando, setTrocando] = useState<string | null>(null);

  // `enabled` importa: sem ele, todo administrador de empresa dispararia um GET
  // /admin/contas que o backend devolveria 403.
  const { data: contas, isLoading } = useApiQuery<ContaItem[]>("/admin/contas", {
    enabled: plataforma,
  });

  if (!plataforma) return null;

  async function ir(alvo: string | null, nome: string) {
    setTrocando(alvo ?? "casa");
    try {
      // Não há `finally` que devolva o botão ao normal: em caso de sucesso a
      // página inteira recarrega, e o spinner deve durar até lá.
      await trocarConta(token, alvo);
    } catch (e) {
      setTrocando(null);
      toast.error(e instanceof Error ? e.message : `Não consegui entrar em ${nome}.`);
    }
  }

  const outras = (contas ?? []).filter((c) => c.id !== contaOrigem?.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Trocar de empresa"
        className={cn(
          "mb-3 flex w-full items-center gap-2 rounded-md border border-sidebar-border px-2 py-2 text-left text-sm transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // Visitando, o próprio seletor já avisa — a faixa no topo reforça.
          assumida && "border-amber-500/60 bg-amber-500/10",
        )}
      >
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{conta?.nome ?? "—"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {assumida ? "Você está visitando" : "Sua empresa"}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="max-h-96 w-64 overflow-y-auto">
        <DropdownMenuLabel>Sua empresa</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            if (!assumida) return;
            void ir(null, contaOrigem?.nome ?? "sua empresa");
          }}
          className="justify-between gap-2"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Home className="h-4 w-4 shrink-0" />
            <span className="truncate">{contaOrigem?.nome ?? "—"}</span>
          </span>
          {trocando === "casa" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            !assumida && <Check className="h-4 w-4 shrink-0" />
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Entrar como suporte</DropdownMenuLabel>

        {isLoading && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Carregando…</div>
        )}
        {!isLoading && outras.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            Nenhuma outra empresa cadastrada.
          </div>
        )}

        {outras.map((c) => {
          const atual = assumida && c.id === conta?.id;
          return (
            <DropdownMenuItem
              key={c.id}
              disabled={!c.ativa}
              onSelect={(e) => {
                e.preventDefault();
                if (atual || !c.ativa) return;
                void ir(c.id, c.nome);
              }}
              className="justify-between gap-2"
            >
              {/* Nome e estado em caixas separadas: com os dois dentro do mesmo
                  `truncate`, nome comprido comia o "(desativada)" — justamente
                  a parte que explica por que o item não clica. */}
              <span className="flex min-w-0 flex-1 items-baseline gap-1">
                <span className="truncate">{c.nome}</span>
                {!c.ativa && (
                  <span className="shrink-0 text-xs text-muted-foreground">(desativada)</span>
                )}
              </span>
              {trocando === c.id ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                atual && <Check className="h-4 w-4 shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
