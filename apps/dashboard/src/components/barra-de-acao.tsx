"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTecladoAberto } from "@/lib/teclado";

/**
 * Rodapé de AÇÃO dos formulários de página (Salvar / Cancelar).
 *
 * Celular (< 768px, `max-md:`): fica FIXA no rodapé da tela, com fundo sólido e linha em cima, respiro
 * do gesto do iPhone (`safe-area-inset-bottom`) e botões de 48px que dividem a largura (Salvar com o dobro
 * do espaço do Cancelar). Quem preenche um cadastro longo não precisa rolar tudo atrás do botão.
 *  - Um espaçador do mesmo tamanho fica no fluxo da página: o último campo NUNCA fica por baixo da barra.
 *  - Com o teclado aberta ela SOME (mesmo critério da barra de navegação, `useTecladoAberto`): no iOS o
 *    teclado não redimensiona a janela e a barra ficaria atrás dele; no Android ela subiria colada no teclado
 *    e comeria ~60px de uma área que já é pequena. Enter no campo envia o formulário; fechou o teclado, a barra volta.
 *
 * Do `md` pra cima NADA muda: o espaçador deixa de existir e o invólucro da barra vira `display: contents`,
 * então os botões ficam como filhos diretos do `flex justify-end gap-2` de sempre.
 *
 * Uso: troque a `<div className="flex justify-end gap-2 pt-2">` por `<BarraDeAcao>` (ou `semTopo` quando a
 * div antiga não tinha o `pt-2`). Os filhos continuam sendo o <BotaoCancelar> e o <Button type="submit">.
 * Não use dentro de janela/folha: lá o rodapé fixo já é o RODAPE_FOLHA.
 */
export function BarraDeAcao({ children, semTopo = false, className }: { children: React.ReactNode; semTopo?: boolean; className?: string }) {
  const teclado = useTecladoAberto();
  return (
    <div
      data-barra-de-acao
      className={cn("max-md:h-[calc(4.5rem+env(safe-area-inset-bottom))] md:flex md:justify-end md:gap-2", !semTopo && "md:pt-2", className)}
    >
      <div
        data-barra-de-acao-fixa
        data-teclado={teclado ? "aberto" : undefined}
        className={cn(
          "md:contents",
          "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:flex max-md:gap-2 max-md:border-t max-md:bg-background",
          "max-md:px-4 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          "max-md:data-[teclado=aberto]:hidden",
          "max-md:[&>button]:h-12 max-md:[&>button]:flex-1 max-md:[&>button]:text-base max-md:[&>button[type=submit]]:flex-[2]",
          // "Cancelar" embrulhado num <Link> (envios/fechamentos/financeiro): o <a> é quem divide a largura
          "max-md:[&>a]:flex-1 max-md:[&>a>button]:h-12 max-md:[&>a>button]:w-full max-md:[&>a>button]:text-base",
        )}
      >
        {children}
      </div>
    </div>
  );
}
