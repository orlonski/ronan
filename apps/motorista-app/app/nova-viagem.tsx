import { router, Stack } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";

export default function NovaViagem() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="px-4 py-3">
        <Button variant="ghost" size="icon" onPress={() => router.back()}>
          <ArrowLeft size={20} color="#0f172a" />
        </Button>
      </View>
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-xl font-semibold text-foreground">Nova viagem</Text>
        <Text className="mt-2 text-center text-sm text-muted-foreground">
          Em construção. Form completo + câmera nativa chegam na próxima fase.
        </Text>
      </View>
    </SafeAreaView>
  );
}
