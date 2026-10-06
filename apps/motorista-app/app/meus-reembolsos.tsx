import { Stack } from "expo-router";
import { MeusGastos } from "@/components/meus-gastos";

/**
 * "Meus gastos" empilhado (com voltar). O conteúdo é o mesmo da aba "Gastos" —
 * ver components/meus-gastos.tsx.
 */
export default function MeusReembolsos() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MeusGastos />
    </>
  );
}
