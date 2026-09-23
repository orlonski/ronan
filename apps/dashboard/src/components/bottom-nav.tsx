"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, HardHat, Home, Menu, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/lib/permissoes";
import { isRotaAtiva } from "@/components/sidebar";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Chave RBAC; ausente = sempre visível. */
  perm?: string;
  /** Match exato do pathname (senão usa startsWith). */
  exact?: boolean;
};

const ITENS: NavItem[] = [
  { href: "/", label: "Início", icon: Home, exact: true },
  { href: "/viagens", label: "Viagens", icon: ClipboardCheck, perm: "viagens.ver" },
  { href: "/viagens-andamento", label: "Ao vivo", icon: Radio, perm: "ao-vivo.ver" },
  { href: "/motoristas", label: "Motoristas", icon: HardHat, perm: "motoristas.ver" },
];

/**
 * Barra de navegação inferior — só no mobile (md:hidden). Atalho pros
 * destinos mais usados + botão "Menu" que abre a gaveta lateral (que continua
 * dando acesso a todas as telas). Respeita RBAC igual à sidebar.
 */
export function BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const { temPermissao, temModulo } = usePermissoes();

  // Mesmo filtro da sidebar: só permissão deixava passar item de módulo não
  // contratado. Hoje os 4 itens são do núcleo, mas o primeiro item de fora dele
  // vazaria no celular.
  const visiveis = ITENS.filter((i) => !i.perm || (temPermissao(i.perm) && temModulo(i.perm)));

  function ativo(item: NavItem) {
    // `startsWith` cru acendia "Viagens" junto de "Ao vivo" em
    // /viagens-andamento. A sidebar já tinha resolvido isso; aqui só faltava
    // usar a mesma regra em vez de manter uma segunda, errada.
    return item.exact ? pathname === item.href : isRotaAtiva(pathname, item.href);
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-sidebar-border bg-background pb-safe md:hidden">
      {visiveis.map((item) => {
        const Icon = item.icon;
        const active = ativo(item);
        return (
          <Link
            key={item.href}
            href={item.href as any}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
        <span>Menu</span>
      </button>
    </nav>
  );
}
