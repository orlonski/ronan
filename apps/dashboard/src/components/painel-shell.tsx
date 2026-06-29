"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { GlobalLoadingBar } from "@/components/loading";
import { SchabaLogo } from "@/components/schaba-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
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

      <div className="flex flex-1 flex-col">
        {/* Header mobile com hamburger */}
        <header className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
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
            <ThemeSwitcher compact />
          </div>
        </header>

        {/* Header desktop só com ações à direita (sininho + tema) */}
        <header className="hidden items-center justify-end gap-1 border-b bg-background px-4 py-2 md:flex">
          <Topbar />
        </header>

        <main className="flex-1 overflow-auto bg-background p-4 md:p-8">
          <TelaGuard>{children}</TelaGuard>
        </main>
      </div>
    </div>
  );
}
