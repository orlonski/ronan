"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { permDaRota, usePermissoes } from "@/lib/permissoes";

const AcessoRestrito = () => (
  <div className="rounded-md border bg-muted/30 p-6">
    <p className="text-sm text-muted-foreground">
      Você não tem acesso a esta tela. Fale com um administrador.
    </p>
  </div>
);

/**
 * Mostra os filhos só se o papel tiver a permissão. Usado pra esconder botões
 * de ação (Novo, Editar, Excluir, etc.) que o usuário não pode usar.
 */
export function Permitido({ chave, children }: { chave: string; children: ReactNode }) {
  const { temPermissao } = usePermissoes();
  return temPermissao(chave) ? <>{children}</> : null;
}

/**
 * Gate central por rota (usado no shell do painel). Lê a permissão exigida pela
 * URL atual e bloqueia se o papel não tiver. Rotas sem permissão mapeada passam.
 * Salvaguarda: usuário sem papel (permissoes vazias) mas perfil ADMIN é liberado
 * pra não trancar um admin mal-configurado.
 */
export function TelaGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { temPermissao, isLoading } = usePermissoes();

  const perm = permDaRota(pathname);
  if (!perm) return <>{children}</>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!temPermissao(perm)) return <AcessoRestrito />;
  return <>{children}</>;
}

/**
 * Gate de tela por permissão. Mostra "Acesso restrito" se o papel do usuário
 * não tiver a chave. Substitui os checks manuais de `perfil !== "ADMIN"`.
 * (O backend é a fonte de verdade — isto só evita renderizar a tela.)
 */
export function RequerTela({ chave, children }: { chave: string; children: ReactNode }) {
  const { temPermissao, isLoading } = usePermissoes();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (!temPermissao(chave)) {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">
          Você não tem acesso a esta tela. Fale com um administrador.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
