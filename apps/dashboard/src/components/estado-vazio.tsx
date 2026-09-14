"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Estado vazio que ENSINA o próximo passo.
 *
 * O padrão antigo era uma frase seca — "Nenhum veículo cadastrado." — que
 * informa e não ajuda: quem abriu a tela já viu que não tem nada. O que falta
 * dizer é por que isso importa e o que fazer agora.
 *
 * Até aqui isso era impossível: `emptyMessage` era tipado `string` e renderizado
 * como texto puro dentro de um `<TableCell>`, então nenhuma lista do painel
 * conseguia pôr um botão no vazio.
 */
export function EstadoVazio({
  icone: Icone,
  titulo,
  descricao,
  acaoHref,
  acaoLabel,
  perm,
  temPermissao,
}: {
  icone?: LucideIcon;
  /** Uma linha, direta: "Nenhum veículo cadastrado". */
  titulo: string;
  /** Por que isso importa — a consequência de continuar vazio. */
  descricao?: string;
  acaoHref?: string;
  acaoLabel?: string;
  /** Chave RBAC da ação. Sem ela, o texto aparece e o botão não. */
  perm?: string;
  temPermissao?: (chave: string) => boolean;
}) {
  const podeAgir = !perm || !temPermissao || temPermissao(perm);
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      {Icone && <Icone className="h-7 w-7 text-muted-foreground/70" aria-hidden />}
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      {descricao && (
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">{descricao}</p>
      )}
      {acaoHref && acaoLabel && podeAgir && (
        <Button size="sm" asChild className="mt-1">
          <Link href={acaoHref as never}>{acaoLabel}</Link>
        </Button>
      )}
    </div>
  );
}
