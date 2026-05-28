import { Share, X } from "lucide-react";
import { useIosInstallPrompt } from "@/hooks/use-ios-install-prompt";

/**
 * Card mostrado em iOS Safari pra incentivar o motorista a instalar o PWA
 * na tela inicial. Sem isso, Web Push não funciona no iOS.
 */
export function IosInstallPrompt() {
  const { show, dismiss } = useIosInstallPrompt();
  if (!show) return null;
  return (
    <div className="relative rounded-2xl border-2 border-brand bg-secondary p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dispensar"
        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:opacity-75"
      >
        <X size={18} />
      </button>
      <p className="pr-9 text-base font-bold text-brand">
        Instale o Schaba na tela inicial
      </p>
      <p className="mt-1 text-sm text-foreground">
        Use o botão{" "}
        <span className="inline-flex items-center gap-1 font-semibold">
          <Share size={14} /> Compartilhar
        </span>{" "}
        do Safari → <strong>Adicionar à Tela de Início</strong>. Assim você recebe
        notificações e o app abre tela cheia.
      </p>
    </div>
  );
}
