import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Label + cor do status da Viagem, num só lugar. Antes vivia copiado em
 * viagens/page.tsx e locais/[id]/ver/page.tsx (mapas idênticos e incompletos).
 * Valores espelham o enum StatusViagem do Prisma / shared-types.
 */
export const STATUS_VIAGEM_LABEL: Record<string, string> = {
  RASCUNHO_OFFLINE: "Rascunho",
  ENVIADA: "Aguardando",
  EM_ANDAMENTO: "Em andamento",
  EM_CONFERENCIA: "Em conferência",
  AGUARDANDO_PESO: "Aguardando peso",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  OK: "OK",
};

export const STATUS_VIAGEM_COLOR: Record<string, string> = {
  RASCUNHO_OFFLINE: "bg-gray-100 text-gray-700 border-gray-200",
  ENVIADA: "bg-amber-100 text-amber-900 border-amber-200",
  EM_ANDAMENTO: "bg-sky-100 text-sky-800 border-sky-200",
  EM_CONFERENCIA: "bg-purple-100 text-purple-800 border-purple-200",
  AGUARDANDO_PESO: "bg-orange-100 text-orange-900 border-orange-300",
  DIVERGENTE: "bg-red-100 text-red-800 border-red-200",
  AJUSTADA: "bg-blue-100 text-blue-800 border-blue-200",
  OK: "bg-green-100 text-green-800 border-green-200",
};

export function statusViagemLabel(status: string): string {
  return STATUS_VIAGEM_LABEL[status] ?? status;
}

/** Selo padrão de status da viagem, reusável em qualquer tela do painel. */
export function StatusViagemBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge className={cn(STATUS_VIAGEM_COLOR[status] ?? "", className)}>
      {statusViagemLabel(status)}
    </Badge>
  );
}
