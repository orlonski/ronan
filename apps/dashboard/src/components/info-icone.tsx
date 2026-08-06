import type { ComponentType, ReactNode } from "react";

/**
 * Um dado de card de lista: ícone + conteúdo, alinhados e com o mesmo
 * espaçamento em todas as linhas. O texto trunca; o ícone nunca encolhe.
 *
 * Usado nos cards de Viagens e Abastecimentos pra manter as duas telas com a
 * mesma cara no celular.
 */
export function InfoIcone({
  icon: Icon,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className ?? ""}`}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </span>
  );
}
