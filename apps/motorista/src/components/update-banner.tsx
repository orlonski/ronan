import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

/**
 * Banner que aparece quando o Service Worker baixou nova versão.
 * Não usa o useRegisterSW direto pra evitar dep do React durante o
 * registro inicial; usa registerSW + estado local.
 */
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [updater, setUpdater] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        setAvailable(true);
      },
      onOfflineReady() {
        /* opcional toast: app pronto offline */
      },
    });
    setUpdater(() => async () => {
      await update(true);
    });
  }, []);

  if (!available) return null;

  return (
    <button
      type="button"
      onClick={() => void updater?.()}
      className="flex items-center gap-3 rounded-2xl border-2 border-primary/40 bg-primary/15 p-4 text-left active:opacity-75"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary">
        <RotateCw size={22} color="white" />
      </div>
      <div className="flex-1">
        <p className="text-base font-bold text-foreground">Nova versão disponível</p>
        <p className="text-sm text-muted-foreground">Toque aqui pra atualizar agora</p>
      </div>
    </button>
  );
}
