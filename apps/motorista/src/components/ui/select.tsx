import { useEffect, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  sublabel?: string;
};

/**
 * Select com sheet full-screen estilo iOS — substitui o select nativo
 * pra ter busca, layout consistente e melhor UX em telas de motorista.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Selecione",
  searchable,
  disabled,
  className,
  emptyMessage,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value);

  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.sublabel?.toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  function fechar() {
    setOpen(false);
    setQuery("");
  }

  // Esc fecha o sheet, body scroll lock enquanto aberto
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") fechar();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-14 w-full items-center justify-between rounded-xl border-2 border-border bg-background px-4 text-left transition-opacity active:opacity-75 disabled:opacity-50",
          className,
        )}
      >
        <span
          className={cn(
            "flex-1 truncate text-[17px] font-medium",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={22} className="text-muted-foreground" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="bg-brand px-4 pb-3 pt-safe">
            <div className="mb-3 flex items-center gap-3 pt-3">
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
              >
                <X size={20} color="white" />
              </button>
              <span className="flex-1 truncate text-xl font-bold text-white">
                {title ?? placeholder}
              </span>
            </div>

            {searchable && (
              <div className="flex items-center gap-2 rounded-xl bg-white px-3">
                <Search size={18} className="text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar..."
                  autoCorrect="off"
                  autoCapitalize="none"
                  className="h-12 flex-1 bg-transparent text-base font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Limpar busca"
                    className="flex h-8 w-8 items-center justify-center"
                  >
                    <X size={18} className="text-muted-foreground" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto pb-safe">
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-base text-muted-foreground">
                {emptyMessage ?? "Nada encontrado"}
              </p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    onChange(item.value);
                    fechar();
                  }}
                  className={cn(
                    "block w-full border-b border-border px-4 py-4 text-left active:bg-muted",
                    item.value === value && "bg-muted",
                  )}
                >
                  <span className="block text-lg font-semibold text-foreground">
                    {item.label}
                  </span>
                  {item.sublabel && (
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {item.sublabel}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
