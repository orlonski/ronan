import { Tabs } from "expo-router";
import { Calendar, House, MessageCircle, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBadgeChat } from "@/lib/chat";
import { useMe } from "@/lib/queries";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // Rollout gradual: sem a flag, a aba nem existe (e a API responde 403).
  const podeChat = useMe().data?.podeChat ?? false;
  const naoLidas = useBadgeChat(podeChat).data ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#13316b",
        tabBarInactiveTintColor: "#64748b",
        tabBarStyle: {
          backgroundColor: "white",
          borderTopColor: "#e2e8f0",
          borderTopWidth: 1,
          height: 64 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Início",
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="historico"
        options={{
          title: "Histórico",
          tabBarIcon: ({ color, size }) => (
            <Calendar color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="conversas"
        options={{
          title: "Conversas",
          // href null tira a aba do tab bar E bloqueia a rota pra quem não tem
          // a flag — não adianta esconder o botão e deixar o caminho aberto.
          href: podeChat ? undefined : null,
          tabBarBadge: naoLidas > 0 ? (naoLidas > 99 ? "99+" : naoLidas) : undefined,
          tabBarBadgeStyle: { backgroundColor: "#dc2626", fontSize: 11 },
          tabBarIcon: ({ color, size }) => (
            <MessageCircle color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
