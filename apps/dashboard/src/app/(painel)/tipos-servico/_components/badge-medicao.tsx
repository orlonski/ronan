import { Clock, Scale } from "lucide-react";

/** Selo do modo de medição — reusado na lista de modos e nas telas de viagem. */
export function BadgeMedicao({ medicao }: { medicao: "PESO" | "PERIODO" }) {
  return medicao === "PERIODO" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
      <Clock className="h-3 w-3" /> Por período
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      <Scale className="h-3 w-3" /> Por peso
    </span>
  );
}
