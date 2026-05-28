import { useEffect, useState } from "react";
import { AlertTriangle, Info, XCircle } from "lucide-react";
import {
  resolveAlert,
  subscribeAlert,
  type AlertOptions,
  type AlertVariant,
} from "@/lib/alert";
import { cn } from "@/lib/utils";

const ICONS: Record<AlertVariant, typeof Info> = {
  default: Info,
  warning: AlertTriangle,
  destructive: XCircle,
};

const ICON_BG: Record<AlertVariant, string> = {
  default: "bg-primary",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

const ICON_COLOR: Record<AlertVariant, string> = {
  default: "text-primary-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive-foreground",
};

const BUTTON_STYLES = {
  default: "bg-primary text-primary-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  cancel: "bg-muted text-foreground",
} as const;

type Current = { id: string; opts: AlertOptions } | null;

/**
 * Mount uma vez em App.tsx. Escuta a fila de showAlert() e renderiza o
 * overlay estilizado. Só mostra um por vez — próximos ficam na fila.
 */
export function AlertHost() {
  const [current, setCurrent] = useState<Current>(null);

  useEffect(() => {
    return subscribeAlert((q) => {
      setCurrent(q[0] ? { id: q[0].id, opts: q[0].opts } : null);
    });
  }, []);

  // Fecha com ESC
  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (current?.opts.dismissible === false) return;
      resolveAlert(current!.id, null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  if (!current) return null;

  const { id, opts } = current;
  const variant = opts.variant ?? "default";
  const buttons = opts.buttons ?? [{ label: "OK", value: "ok" }];
  const Icon = ICONS[variant];

  function press(value: string | null) {
    resolveAlert(id, value);
  }

  function dismiss() {
    if (opts.dismissible === false) return;
    press(null);
  }

  const stacked = buttons.length >= 3;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`alert-title-${id}`}
      onClick={dismiss}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-6 animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl animate-in zoom-in-95"
      >
        <div className="flex flex-col items-center">
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full",
              ICON_BG[variant],
            )}
          >
            <Icon size={28} strokeWidth={2.5} className={ICON_COLOR[variant]} />
          </div>
          <h2
            id={`alert-title-${id}`}
            className="mt-4 text-center text-xl font-bold text-foreground"
          >
            {opts.title}
          </h2>
          {opts.message ? (
            <p className="mt-2 whitespace-pre-line text-center text-base leading-6 text-muted-foreground">
              {opts.message}
            </p>
          ) : null}
        </div>

        <div className={cn("mt-6 flex gap-3", stacked && "flex-col gap-2")}>
          {buttons.map((b, i) => (
            <button
              key={`${b.label}-${i}`}
              type="button"
              onClick={() => press(b.value ?? b.label)}
              className={cn(
                "inline-flex h-14 items-center justify-center rounded-xl px-4 font-bold text-base transition-opacity active:opacity-75",
                stacked ? "w-full" : "flex-1",
                BUTTON_STYLES[b.style ?? "default"],
              )}
            >
              <span className="truncate">{b.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
