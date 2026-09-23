"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * As duas metades de "Papéis e permissões": o que cada papel faz no PAINEL
 * e o que cada tipo de pessoa vê no APP. Mesma ideia (quem × o quê, marcando
 * caixinhas), por isso a mesma tela — foi o que o dono pediu ao ver a tela de
 * acesso do app separada e sem jeito.
 */
export function AbasPermissoes() {
  const path = usePathname();
  const { temPermissao } = usePermissoes();
  const abas = (
    [
      { href: "/configuracoes/permissoes", label: "Painel do escritório", perm: "permissoes.gerenciar" },
      { href: "/acesso-app", label: "App do motorista", perm: "perfis-acesso.ver" },
    ] as const
  ).filter((a) => temPermissao(a.perm));
  if (abas.length < 2) return null;
  return (
    <div className="flex gap-1 border-b border-border">
      {abas.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            path.startsWith(a.href)
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {a.label}
        </Link>
      ))}
    </div>
  );
}
