import type { StatusMotorista } from "@ronan/shared-types";

const MAPA: Record<StatusMotorista, { label: string; className: string }> = {
  PENDENTE_APROVACAO: { label: "Pendente", className: "bg-amber-100 text-amber-700" },
  APROVADO: { label: "Aprovado", className: "bg-emerald-100 text-emerald-700" },
  REJEITADO: { label: "Rejeitado", className: "bg-red-100 text-red-700" },
};

/** Badge colorida do status de aprovação do cadastro do motorista. */
export function StatusCadastroBadge({ status }: { status: StatusMotorista }) {
  const { label, className } = MAPA[status];
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
