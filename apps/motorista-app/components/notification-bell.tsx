import { router } from "expo-router";
import { Bell } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useNaoLidas } from "@/lib/queries";

/**
 * Sino com badge de não-lidas. Esconde badge se 0; mostra "99+" se > 99.
 * Pra usar no header brand da home.
 */
export function NotificationBell() {
  const count = useNaoLidas();
  return (
    <Pressable
      onPress={() => router.push("/notificacoes")}
      className="h-12 w-12 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
      hitSlop={8}
      accessibilityLabel={count > 0 ? `Notificações: ${count} não lidas` : "Notificações"}
    >
      <Bell size={22} color="white" />
      {count > 0 && (
        <View
          className="absolute -right-0.5 -top-0.5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1"
          style={{ height: 20 }}
        >
          <Text
            className="text-[11px] font-extrabold text-white"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
