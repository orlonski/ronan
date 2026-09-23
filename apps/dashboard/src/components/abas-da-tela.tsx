"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * TELAS-IRMÃS COMO ABAS de um item só do menu.
 *
 * Regra decidida com o dono em 23/09/2026: configuração que só serve a uma
 * tela mora DENTRO dela, como aba — quem está em Locais pensando "por que o
 * app não achou a pedreira?" não tinha como adivinhar que a resposta estava em
 * Ajustes. O item do menu correspondente usa `ou` (sidebar.tsx) com as mesmas
 * rotas, pra abrir na primeira aba que a pessoa pode ver.
 *
 * Cada aba mantém a permissão (e o módulo) que a tela já tinha. `perm: null`
 * = qualquer um (o Contrato: quem é obrigado a aceitar tem que poder reler).
 */
type Aba = { href: string; label: string; perm: string | null };

export const ABAS = {
  permissoes: [
    { href: "/configuracoes/permissoes", label: "Painel do escritório", perm: "permissoes.gerenciar" },
    { href: "/acesso-app", label: "App do motorista", perm: "perfis-acesso.ver" },
  ],
  "minha-empresa": [
    { href: "/configuracoes/empresa", label: "Dados da empresa", perm: "minha-empresa.editar" },
    { href: "/configuracoes/cte", label: "Emissor de CT-e", perm: "cte.ver" },
    { href: "/configuracoes/contrato", label: "Contrato", perm: null },
  ],
  locais: [
    { href: "/locais", label: "Locais", perm: "locais.ver" },
    { href: "/configuracoes/busca-locais", label: "Como o app acha o local", perm: "config-busca-locais.ver" },
  ],
  mapa: [
    { href: "/mapa", label: "Mapa", perm: "mapa.ver" },
    { href: "/configuracoes/tracking", label: "Posição durante a viagem", perm: "config-tracking.ver" },
  ],
  torre: [
    { href: "/torre", label: "Torre de controle", perm: "programacao.ver" },
    { href: "/configuracoes/torre", label: "Quando avisar", perm: "programacao.ver" },
  ],
  viagens: [
    { href: "/viagens", label: "Viagens", perm: "viagens.ver" },
    { href: "/configuracoes/km-atipico", label: "Km fora do padrão", perm: "config-km-atipico.ver" },
  ],
} satisfies Record<string, Aba[]>;

export function AbasDaTela({ grupo }: { grupo: keyof typeof ABAS }) {
  const path = usePathname();
  const { temPermissao, temModulo } = usePermissoes();
  const abas = (ABAS[grupo] as Aba[]).filter(
    (a) => a.perm === null || (temPermissao(a.perm) && temModulo(a.perm)),
  );
  // Uma aba só não é escolha: a pessoa vê a tela como sempre viu.
  if (abas.length < 2) return null;
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {abas.map((a) => {
        const ativa = path === a.href || path.startsWith(`${a.href}/`);
        return (
          <Link
            key={a.href}
            href={a.href as Route}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              ativa
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
