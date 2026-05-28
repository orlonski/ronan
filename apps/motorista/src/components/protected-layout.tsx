import type { ReactNode } from "react";
import { BottomTabs } from "./bottom-tabs";

/**
 * Layout das telas com tab bar inferior (Home, Histórico, Perfil).
 * Telas internas (nova-viagem, viagens/:id, etc) não usam esse layout —
 * têm o ScreenHeader e ocupam a tela inteira.
 */
export function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen-safe flex-col">
      <main className="flex-1 pb-24">{children}</main>
      <BottomTabs />
    </div>
  );
}
