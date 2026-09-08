import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Header brand pras telas internas: pinta o azul atrás da barra de status,
 * botão de voltar e título grande. Aceita `right` (ação no canto) e `subtitle`.
 *
 * O fundo azul não é decoração: `app/_layout.tsx` fixa `StatusBar style="light"`
 * pro app inteiro, ou seja, relógio, sinal e bateria são BRANCOS. Tela com topo
 * claro faz os ícones do iPhone sumirem — foi o "ficou tudo branco no topo" que
 * o motorista reportou. Todo topo de tela aqui é escuro, por isso.
 *
 * O espaço de cima vem do inset real (`useSafeAreaInsets`), não de um `pt-14`
 * chutado: 56px é MENOS que o inset de um iPhone com Dynamic Island (59-62px),
 * e o título encostava nos ícones do sistema.
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  semVoltar,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  /** Telas de onde voltar não faz sentido (ex.: fechar um frete já parado). */
  semVoltar?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="bg-brand px-4 pb-4"
      style={{ paddingTop: insets.top + 12 }}
    >
      <View className="flex-row items-center gap-3">
        {!semVoltar && (
          <Pressable
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
          >
            <ArrowLeft size={22} color="white" />
          </Pressable>
        )}
        <View className="flex-1">
          <Text className="text-2xl font-bold text-white" numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            <Text className="text-sm font-medium text-white/80" numberOfLines={2}>
              {subtitle}
            </Text>
          )}
        </View>
        {right}
      </View>
    </View>
  );
}
