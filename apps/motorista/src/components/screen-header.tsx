import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Header brand pras telas internas. Cobre o status bar (pt-safe + pt-3)
 * e tem botão back + título grande. Aceita `right` opcional pra ação no canto.
 */
export function ScreenHeader({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="bg-brand px-4 pb-4 pt-safe">
      <div className="flex items-center gap-3 pt-3">
        <button
          type="button"
          onClick={onBack ?? (() => navigate(-1))}
          aria-label="Voltar"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
        >
          <ArrowLeft size={22} color="white" />
        </button>
        <h1 className="flex-1 truncate text-2xl font-bold text-white">{title}</h1>
        {right}
      </div>
    </div>
  );
}
