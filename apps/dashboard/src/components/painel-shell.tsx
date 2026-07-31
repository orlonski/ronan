"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { GlobalLoadingBar } from "@/components/loading";
import { SchabaLogo } from "@/components/schaba-logo";
import { Topbar } from "@/components/topbar";
import { TelaGuard } from "@/components/requer-tela";
import { useInboxStream } from "@/lib/inbox";

/**
 * Shell do painel: cuida da gaveta lateral no mobile + header com
 * hamburger. No desktop, sidebar fica fixa visível como antes.
 *
 * useInboxStream e' chamado aqui (UMA VEZ) pra abrir o stream SSE que
 * atualiza o sininho em tempo real. Cleanup acontece no unmount.
 */
export function PainelShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  useInboxStream();

  return (
    <div className="flex min-h-screen">
      <GlobalLoadingBar />
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile com hamburger — fixo no topo ao rolar (cara de app) */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background px-4 py-3 pt-safe md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-foreground hover:bg-muted"
            aria-label="Abrir menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center">
            <SchabaLogo width={112} className="text-foreground" />
          </div>
          <div className="flex items-center gap-1">
            <Topbar />
          </div>
        </header>

        {/* Header desktop só com ações à direita (sininho + tema) */}
        <header className="hidden items-center justify-end gap-1 border-b bg-background px-4 py-2 md:flex">
          <Topbar />
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-background p-4 pb-24 md:p-8 md:pb-8">
          <TelaGuard>{children}</TelaGuard>
        </main>
      </div>

      {/* Barra de navegação inferior (só mobile) */}
      <BottomNav onOpenMenu={() => setMobileOpen(true)} />
    </div>
  );
}
