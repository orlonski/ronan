"use client";

import { cn } from "@/lib/utils";

/**
 * Toggle ativo/inativo. Substitui o botão de "lixeira" antigo que só
 * inativava sem permitir reativar. Visual estilo iOS (switch).
 */
export function StatusToggle({
  active,
  onChange,
  disabled = false,
  size = "md",
  label,
}: {
  active: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Se passado, mostra o texto "ativo"/"inativo" ao lado. */
  label?: boolean;
}) {
  const dims =
    size === "sm"
      ? { track: "h-5 w-9", thumb: "h-4 w-4", translate: "translate-x-4" }
      : { track: "h-6 w-11", thumb: "h-5 w-5", translate: "translate-x-5" };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={active}
        disabled={disabled}
        onClick={() => onChange(!active)}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          dims.track,
          active ? "bg-green-600" : "bg-gray-300",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition",
            dims.thumb,
            active ? dims.translate : "translate-x-0",
          )}
        />
      </button>
      {label && (
        <span
          className={cn(
            "text-xs font-medium",
            active ? "text-green-700" : "text-muted-foreground",
          )}
        >
          {active ? "ativo" : "inativo"}
        </span>
      )}
    </div>
  );
}
