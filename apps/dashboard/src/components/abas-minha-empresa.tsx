"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * As abas de "Minha empresa": os dados da transportadora, o emissor de CT-e e
 * o contrato com a Movatruck. Eram três itens no menu (o dono pediu pra
 * juntar em 23/09/2026) — tudo é "sobre a minha empresa", e o emissor usa a
 * identidade fiscal que mora na primeira aba.
 *
 * Cada aba respeita a permissão e o módulo dela; o Contrato não tem permissão
 * de propósito (o aceite dos termos vale pra todo mundo, e quem é obrigado a
 * aceitar tem que conseguir reler).
 */
export function AbasMinhaEmpresa() {
  const path = usePathname();
  const { temPermissao, temModulo } = usePermissoes();
  const abas = (
    [
      { href: "/configuracoes/empresa", label: "Dados da empresa", perm: "minha-empresa.editar" },
      { href: "/configuracoes/cte", label: "Emissor de CT-e", perm: "cte.ver" },
      { href: "/configuracoes/contrato", label: "Contrato", perm: null },
    ] as const
  ).filter((a) => a.perm === null || (temPermissao(a.perm) && temModulo(a.perm)));
  if (abas.length < 2) return null;
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {abas.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
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
