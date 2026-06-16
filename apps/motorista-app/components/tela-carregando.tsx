import { ActivityIndicator, Image, Text, View } from "react-native";

// Mesmo logo do splash nativo — o handoff splash → React não pisca.
const LOGO = require("../assets/splash.png");

/**
 * Tela de carregamento full-screen que casa com o splash nativo (fundo branco
 * + logo Schaba). Usada no boot: enquanto baixa a OTA (com mensagem) e enquanto
 * a auth resolve (sem mensagem, só o spinner).
 */
export function TelaCarregando({ mensagem }: { mensagem?: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-white px-10">
      <Image
        source={LOGO}
        resizeMode="contain"
        style={{ width: 260, height: 260 }}
      />
      <ActivityIndicator size="large" color="hsl(220, 75%, 28%)" className="mt-6" />
      {mensagem ? (
        <Text className="mt-4 text-center text-base font-medium text-muted-foreground">
          {mensagem}
        </Text>
      ) : null}
    </View>
  );
}
