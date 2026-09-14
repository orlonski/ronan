"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/client-api";
import { cn } from "@/lib/utils";

/**
 * O que aparece quando a lista não carregou.
 *
 * Existe porque o `DataTable` não tinha ramo de erro: um 403 de módulo ou um
 * 500 da API caíam no mesmo lugar que "nenhum resultado" e o operador lia
 * "Nenhum registro encontrado." — ia mexer nos filtros por dez minutos
 * procurando um dado que o servidor nunca mandou.
 *
 * Distinguir os dois casos é o ponto: vazio é um fato sobre os dados, erro é um
 * fato sobre a conexão. Só o segundo tem "tentar de novo".
 */

function textoDoErro(erro: unknown): { titulo: string; detalhe: string } {
  if (erro instanceof ApiError) {
    if (erro.status === 403) {
      return {
        titulo: "Você não tem acesso a esta lista",
        detalhe: "Peça a quem administra o painel pra liberar, ou confira se o módulo está contratado.",
      };
    }
    if (erro.status >= 500) {
      return {
        titulo: "O servidor falhou ao montar esta lista",
        detalhe: "Nenhum dado foi perdido. Tente de novo em alguns instantes.",
      };
    }
    return { titulo: "Não consegui carregar esta lista", detalhe: erro.message };
  }
  return {
    titulo: "Não consegui carregar esta lista",
    detalhe: "Pode ser queda de conexão. Os dados não foram perdidos.",
  };
}

export function ErroEstado({
  erro,
  onRetry,
  className,
}: {
  erro: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const { titulo, detalhe } = textoDoErro(erro);
  return (
    <div className={cn("flex flex-col items-center gap-3 px-4 py-8 text-center", className)}>
      <AlertCircle className="h-6 w-6 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">{detalhe}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

/** Mesma coisa dentro de um Card — pras telas que montam a query na mão. */
export function ErroCard({
  erro,
  onRetry,
  className,
}: {
  erro: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <ErroEstado erro={erro} onRetry={onRetry} />
    </Card>
  );
}
