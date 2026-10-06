import { Stack } from "expo-router";
import { CadernoPessoal } from "@/components/caderno-pessoal";
import { ScreenHeader } from "@/components/screen-header";

/**
 * "Meu caderno pessoal", empilhado e aberto pelo Perfil. Existe porque, em
 * empresa com o módulo "Gasto de viagem", a aba Caderno dá lugar à aba Gastos —
 * e `href: null` fecha a rota da aba. O conteúdo é o mesmo da aba.
 */
export default function CadernoPessoalScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CadernoPessoal
        cabecalho={
          <ScreenHeader title="Meu caderno pessoal" subtitle="Só seu — nenhuma empresa vê" />
        }
      />
    </>
  );
}
