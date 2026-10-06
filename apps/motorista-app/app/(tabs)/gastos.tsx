import { MeusGastos } from "@/components/meus-gastos";

/**
 * ABA GASTOS: só em empresa com o módulo "Gasto de viagem" — ocupa o lugar da
 * aba Caderno (ver `useAbaGastos` e `(tabs)/_layout.tsx`). Lançar no topo,
 * acompanhar embaixo.
 */
export default function GastosScreen() {
  return <MeusGastos naAba />;
}
