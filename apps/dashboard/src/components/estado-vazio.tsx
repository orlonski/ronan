"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissoes } from "@/lib/permissoes";

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
  const { estadoConta } = usePermissoes();
  /**
   * Empresa em somente leitura não ganha botão de criar.
   *
   * A permissão sozinha não bastava: quem está com o teste vencido TEM a chave,
   * então o convite aparecia inteiro, a pessoa abria o formulário, preenchia e
   * só descobria no "Salvar". Oferecer uma porta que o servidor vai fechar é
   * pior do que não oferecer porta nenhuma — e o motivo já vem escrito de lá.
   */
  const bloqueada = estadoConta?.podeEscrever === false;
  const podeAgir = (!perm || !temPermissao || temPermissao(perm)) && !bloqueada;
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
      {/* Curto de propósito: a faixa do topo já explica o estado inteiro, e
          repetir o parágrafo aqui embaixo dele só faz a tela parecer um aviso
          de cobrança. Aqui basta dizer por que o botão não está onde deveria. */}
      {acaoHref && acaoLabel && bloqueada && (
        <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
          Com o teste terminado, não dá pra cadastrar — veja a faixa no topo.
        </p>
      )}
    </div>
  );
}
