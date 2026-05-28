import { Calendar } from "lucide-react";
import { useRef } from "react";
import { fmtDataBR } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * Wrapper sobre <input type="date"> que mostra DD/MM/YYYY na UI
 * mas guarda no estado ISO 'YYYY-MM-DD' (compatível com backend).
 * Toque na área visível abre o picker nativo do iOS/Android.
 */
export function DateField({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function abrir() {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    // showPicker é o caminho moderno (Chrome/Edge/Safari 16+), com fallback pra focus.
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        /* fallback abaixo */
      }
    }
    el.focus();
    el.click();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={abrir}
        disabled={disabled}
        className={cn(
          "flex h-14 w-full items-center justify-between rounded-xl border-2 border-border bg-background px-4 text-left active:opacity-75 disabled:opacity-50",
          className,
        )}
      >
        <span className="flex-1 text-[17px] font-medium text-foreground">
          {fmtDataBR(value)}
        </span>
        <Calendar size={22} className="text-muted-foreground" />
      </button>
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        // Acessível via label clicável (botão acima), mas invisível na UI.
        // Não usa display:none porque iOS pode bloquear o picker nesse caso.
        className="pointer-events-none absolute inset-0 opacity-0"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}
