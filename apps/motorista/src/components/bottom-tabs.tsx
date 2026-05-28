import { Calendar, House, User } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

type Tab = { to: string; label: string; icon: typeof House; end?: boolean };

const tabs: Tab[] = [
  { to: "/", label: "Início", icon: House, end: true },
  { to: "/historico", label: "Histórico", icon: Calendar },
  { to: "/perfil", label: "Perfil", icon: User },
];

/**
 * Tab bar inferior fixa, espelhando o Tabs do expo-router do nativo.
 * Padding bottom respeita safe-area (home indicator iPhone).
 */
export function BottomTabs() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-safe">
      <ul className="flex">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition-colors",
                  isActive ? "text-brand" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={24}
                    strokeWidth={isActive ? 2.4 : 2}
                    color={isActive ? "#13316b" : "#64748b"}
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
