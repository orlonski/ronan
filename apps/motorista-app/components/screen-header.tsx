import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * Header brand pras telas internas. Cobre o status bar (pt-14)
 * e tem botao back + titulo grande. Aceita `right` opcional pra
 * ação no canto (ex: "Marcar todas").
 */
export function ScreenHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <View className="bg-brand px-4 pb-4 pt-14">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          className="h-12 w-12 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
        >
          <ArrowLeft size={22} color="white" />
        </Pressable>
        <Text className="flex-1 text-2xl font-bold text-white" numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
    </View>
  );
}
