import type { Metadata } from "next";
import { PortalObra } from "./_components/portal-obra";

/**
 * Portal da obra: o encarregado do CLIENTE da transportadora entra aqui pelo
 * celular (código no WhatsApp). Fora do `(painel)` de propósito — não tem
 * next-auth, menu, nem nada do painel; a sessão é a do portal.
 */
export const metadata: Metadata = {
  title: "Acompanhamento da obra · Movatruck",
  description: "Entregas do dia, programação e pedido de caminhão da sua obra.",
  // Tela de cliente logado: nada a indexar.
  robots: { index: false, follow: false },
};

export default function ObraPage() {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <PortalObra />
    </div>
  );
}
