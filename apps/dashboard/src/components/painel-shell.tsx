"use client";

import { useState } from "react";
import Image from "next/image";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { GlobalLoadingBar } from "@/components/loading";

/**
 * Shell do painel: cuida da gaveta lateral no mobile + header com
 * hamburger. No desktop, sidebar fica fixa visível como antes.
 */
export function PainelShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <GlobalLoadingBar />
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex flex-1 flex-col">
        {/* Header mobile com hamburger (só aparece em mobile) */}
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
            <Image
              src="/schaba-logo.png"
              alt="Schaba"
              width={1642}
              height={614}
              className="h-auto w-28"
            />
          </div>
          <div className="w-10" />
        </header>

        <main className="flex-1 overflow-auto bg-background p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
