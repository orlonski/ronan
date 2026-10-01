"use client";

import { AceiteTermos } from "@/components/aceite-termos";
import { AvisoConta } from "@/components/aviso-conta";
import { AvisoVisita } from "@/components/aviso-visita";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { GlobalLoadingBar } from "@/components/loading";
import { CabecalhoMobile } from "@/components/cabecalho-mobile";
import { CabecalhoProvider } from "@/lib/cabecalho";
import { ehPaginaRaiz } from "@/lib/menu";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Topbar } from "@/components/topbar";
import { BotaoMenu, FundoDaGaveta } from "@/components/menu-lateral";
import { TelaGuard } from "@/components/requer-tela";
import { SobreATela } from "@/components/sobre-a-tela";
import { TourHost } from "@/components/tour-host";
import { useInboxStream } from "@/lib/inbox";

/**
 * Shell do painel. No desktop (>= 768px): sidebar fixa + cabeçalho fininho com
 * o sino. No celular: cabeçalho compacto (logo ou Voltar + título, sino) e
 * barra inferior com a folha "Mais" — ver cabecalho-mobile.tsx e bottom-nav.tsx.
 *
 * useInboxStream e' chamado aqui (UMA VEZ) pra abrir o stream SSE que
 * atualiza o sininho em tempo real. Cleanup acontece no unmount.
 */
export function PainelShell({ children }: { children: React.ReactNode }) {
  useInboxStream();
  // A barra inferior só existe em página raiz; nas filhas o rodapé do conteúdo
  // não precisa da folga de 6rem que ela ocupava.
  const raiz = ehPaginaRaiz(usePathname());

  return (
    <CabecalhoProvider>
    <div className="flex min-h-dvh">
      {/* Bloqueia o painel quando há termo pendente. Renderiza null quando
          não há — ver o componente. */}
      <AceiteTermos />
      {/* Depois do aceite, e nunca por cima dele: o modal de termos é
          bloqueante, e um tour por baixo apontaria pra coisas que ninguém
          consegue ver nem clicar. O host checa isso antes de abrir sozinho. */}
      <TourHost />
      {/* Quem navega por teclado passava pelos 50+ links do menu antes de
          chegar no conteúdo, em toda tela. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Pular para o conteúdo
      </a>
      <GlobalLoadingBar />
      <Sidebar />
      {/* Fundo da gaveta do menu (faixa 768–1535px com o menu recolhido). Escondido por CSS. */}
      <FundoDaGaveta />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Faixa e cabeçalho grudam juntos no topo: o aviso de que você está
            dentro de outra empresa não pode sumir ao rolar a página. O `sticky`
            e o `pt-safe` vivem aqui, no envelope, e não em cada header — dois
            elementos com `top-0` se sobreporiam. */}
        {/* No celular o envelope tem fundo próprio: com a barra de status do
            iPhone imersiva, a área do notch (pt-safe) fica DENTRO dele e o
            conteúdo que rola por baixo não pode aparecer ali. */}
        <div className="sticky top-0 z-30 pt-safe max-md:bg-background">
          <AvisoVisita />
          <AvisoConta />

          <CabecalhoMobile />

          {/* Header desktop só com ações à direita (sininho + tema) */}
          <header className="hidden items-center justify-end gap-1 border-b bg-background px-4 py-2 md:flex">
            {/* Hambúrguer: só aparece (por CSS) quando o menu está recolhido numa gaveta. */}
            <BotaoMenu />
            <Topbar />
          </header>
        </div>

        <main
          id="conteudo"
          tabIndex={-1}
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden bg-background p-4 md:p-[var(--ux-pad-main)] md:pb-[var(--ux-pad-main)]",
            raiz ? "pb-24" : "pb-[calc(2rem+env(safe-area-inset-bottom))]",
          )}
        >
          {/* "Para que serve esta tela", escolhida pela rota.
              
              ⚠️ DENTRO do guard, não acima dele. Fora, ela aparecia por cima
              de "Você não tem acesso a esta tela" e de "sua empresa não
              contratou" — explicar em detalhe o que alguém não pode abrir não
              é ajudar, é provocar. Só vi isso abrindo a tela; no código as
              duas versões são a mesma linha. */}
          <TelaGuard>
            <SobreATela />
            {children}
          </TelaGuard>
        </main>
      </div>

      {/* Barra de navegação inferior (só mobile) */}
      <BottomNav />
    </div>
    </CabecalhoProvider>
  );
}
