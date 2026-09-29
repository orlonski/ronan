"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { FolhaMais } from "@/components/folha-mais";
import { destinosDaBarra, ehPaginaRaiz, GRUPOS, itemAtivo, useMenuVisivel } from "@/lib/menu";
import { useTecladoAberto } from "@/lib/teclado";

// O passo a passo aponta pra "Começar" e pros grupos do menu, que no celular
// moram dentro da folha (fechada = sem medida). O botão "Mais" é a âncora deles:
// declara todas as chaves, e o medirAlvo usa a primeira que estiver na tela.
const ANCORAS_DO_TOUR = ["mais", "comecar", ...GRUPOS.map((g) => g.coach)].join(" ");

/**
 * Barra de navegação inferior — só no celular (md:hidden), como a de um app.
 *
 * Os 4 destinos vêm da semente de lib/menu.ts filtrada pelo que a pessoa pode
 * ver; o "Mais" abre a folha com todas as telas. Some em página filha (que tem
 * Voltar no cabeçalho) e enquanto o teclado está aberto.
 */
export function BottomNav() {
  const pathname = usePathname();
  const menu = useMenuVisivel();
  const teclado = useTecladoAberto();
  const [maisAberto, setMaisAberto] = useState(false);

  const destinos = destinosDaBarra(menu);
  // A folha fica FORA da condição: abrir a folha põe o foco na busca (teclado
  // aberto = barra some), e desmontar a barra levava a folha junto.
  const mostrarBarra = ehPaginaRaiz(pathname) && !teclado;

  return (
    <>
      {mostrarBarra && (
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-sidebar-border bg-background pb-safe md:hidden"
      >
        {destinos.map((item) => {
          const Icon = item.icon;
          const ativo = itemAtivo(pathname, item);
          return (
            <Link
              key={item.base}
              href={item.href as any}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors",
                ativo ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-6 w-6" />
              <span className="max-w-full truncate px-1">{item.rotulo}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMaisAberto(true)}
          data-coach={ANCORAS_DO_TOUR}
          aria-haspopup="dialog"
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <LayoutGrid className="h-6 w-6" />
          <span>Mais</span>
        </button>
      </nav>
      )}
      <FolhaMais open={maisAberto} onOpenChange={setMaisAberto} />
    </>
  );
}
