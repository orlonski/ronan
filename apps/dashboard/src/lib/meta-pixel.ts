/**
 * Pixel da Meta, só onde a venda acontece.
 *
 * O objetivo é a Meta aprender que o SUCESSO de uma campanha é alguém começar o
 * teste de 30 dias, e não um clique (decisão do dono, 28/09/2026). Por isso o
 * pixel mora só na página de cadastro: é ali que o `StartTrial` dispara, e é
 * ali que chega quem tocou no anúncio (a Meta cola o `fbclid` no link e o pixel
 * guarda no cookie `_fbc`, que liga o teste ao anúncio).
 *
 * O resto do painel não carrega o pixel: tela de cliente não é vitrine, e o
 * site institucional foi feito sem cookie de propósito (`site/src/lib/analytics.ts`).
 *
 * `StartTrial` é evento PADRÃO da Meta, não personalizado: a otimização da
 * campanha entende o padrão sem configuração, e dá pra criar a conversão
 * personalizada em cima dele se quiser outro nome no relatório.
 *
 * Quem pediu pra não ser rastreado (Global Privacy Control ou Do Not Track) não
 * carrega o pixel — a mesma régua do analytics do site.
 */

/** Público: o id do pixel aparece no HTML de qualquer site que o use. */
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "1099669029190103";

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  push?: unknown;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

function recusouRastreio(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** Carrega o pixel e manda o PageView. Idempotente: chamar duas vezes não duplica. */
export function iniciarMetaPixel(): void {
  if (typeof window === "undefined" || !META_PIXEL_ID || recusouRastreio()) return;
  if (window.fbq) return;

  // O snippet oficial da Meta, reescrito sem o IIFE minificado.
  const fbq: Fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);

  fbq("init", META_PIXEL_ID);
  fbq("track", "PageView");
}

/**
 * Um evento padrão. `eventID` é o que a Meta usa pra não contar duas vezes
 * quando o mesmo evento também chegar pelo servidor (Conversions API) — o
 * próximo passo.
 */
export function rastrearMeta(evento: "StartTrial" | "Lead" | "CompleteRegistration", eventID?: string): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", evento, {}, eventID ? { eventID } : undefined);
}
