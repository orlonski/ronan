import type { ReactNode } from "react";
import { router } from "expo-router";
import { Lock } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { CapacidadeApp } from "@ronan/shared-types";
import { useCapacidade } from "@/lib/acessos-app";
import { EmptyState } from "./empty-state";
import { ScreenHeader } from "./screen-header";

/**
 * A GUARDA DA TELA: esconder o botão não basta, porque a tela também se abre
 * por notificação, por link e pelo "voltar" de uma pilha antiga.
 *
 * Só barra quando o servidor DISSE que não (`false`). Sem resposta pra esta
 * empresa, a tela abre como sempre abriu — ver lib/acessos-app.ts.
 *
 * O texto não fala em "permissão" nem em "bloqueado": ele é parceiro, e o que
 * aconteceu é que a empresa não usa isso com ele. Quem decide é o escritório.
 */
export function RequerCapacidade({
  chave,
  titulo,
  children,
}: {
  chave: CapacidadeApp;
  titulo: string;
  children: ReactNode;
}) {
  const tem = useCapacidade(chave);
  if (tem !== false) return <>{children}</>;
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={titulo} />
      <EmptyState
        icon={Lock}
        title="Isso não está no seu app nesta empresa"
        description="Se você precisa disso, fale com o escritório da empresa."
      />
      <View className="px-6">
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          className="items-center rounded-xl border-2 border-border bg-background py-3 active:opacity-75"
        >
          <Text className="text-base font-semibold text-foreground">Voltar</Text>
        </Pressable>
      </View>
    </View>
  );
}
