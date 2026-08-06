"use client";

import dynamic from "next/dynamic";

/**
 * Wrapper client-only do mapa do comprovante.
 *
 * Existe porque `next/dynamic` com `ssr: false` não é permitido dentro de
 * Server Component no App Router — e a página do comprovante é server (SSR pro
 * preview do WhatsApp). O `"use client"` daqui é o que libera o dynamic abaixo.
 */
const MapaLeaflet = dynamic(() => import("./mapa-leaflet").then((m) => m.MapaLeaflet), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-md border bg-slate-100" />,
});

export type PontoMapa = { lat: number; lng: number; nome: string };

export function MapaComprovante(props: {
  origem: PontoMapa | null;
  destino: PontoMapa | null;
  geometria: string | null;
}) {
  if (!props.origem && !props.destino && !props.geometria) return null;
  return <MapaLeaflet {...props} />;
}
