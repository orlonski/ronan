"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Fuel, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Troca entre os relatórios. São telas separadas (cada uma com o próprio
 * recorte, dimensões e export) e não abas de um componente só — o que elas
 * agregam não tem nada em comum além do período.
 *
 * O período viaja no link: `useDataTableState` dá precedência à URL sobre o
 * localStorage, então quem estava olhando julho em Viagens continua em julho ao
 * clicar em Abastecimentos, em vez de voltar pro mês corrente.
 */

const ABAS = [
  { href: "/relatorios/viagens", label: "Viagens", icon: Truck },
  { href: "/relatorios/abastecimentos", label: "Abastecimentos", icon: Fuel },
] as const;

export function RelatorioTabs({ de, ate }: { de?: string; ate?: string }) {
  const pathname = usePathname();
  const periodo = de && ate ? `?de=${de}&ate=${ate}` : "";

  return (
    <div className="flex gap-1 border-b">
      {ABAS.map((aba) => {
        const ativa = pathname.startsWith(aba.href);
        return (
          <Link
            key={aba.href}
            // typedRoutes não sabe validar rota + query montada em runtime.
            href={`${aba.href}${periodo}` as Route}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              ativa
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <aba.icon className="h-4 w-4" />
            {aba.label}
          </Link>
        );
      })}
    </div>
  );
}
