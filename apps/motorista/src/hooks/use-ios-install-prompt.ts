import { useEffect, useState } from "react";

const DISMISS_KEY = "ronan.iosInstall.dismissed";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Mostra o prompt "Instale na tela inicial" apenas em iOS Safari não-standalone
 * e não dispensado nas últimas 14 dias. Único caminho de Web Push no iOS.
 */
export function useIosInstallPrompt(): {
  show: boolean;
  dismiss: () => void;
} {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIos()) return;
    if (isStandalone()) return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    const seteDias = 14 * 24 * 60 * 60 * 1000;
    if (Date.now() - dismissedAt < seteDias) return;
    setShow(true);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  return { show, dismiss };
}
