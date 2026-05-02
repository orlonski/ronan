import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Home() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-2xl font-semibold text-foreground">
          Ronan Motorista
        </Text>
        <Text className="mt-2 text-base text-muted-foreground">
          App nativo em construção.
        </Text>
      </View>
    </SafeAreaView>
  );
}
