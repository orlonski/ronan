import { useState } from "react";
import { router } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";

export default function LoginScreen() {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function entrar() {
    setErro(null);
    if (!usuario.trim() || !senha) {
      setErro("Informe usuário e senha");
      return;
    }
    setSubmitting(true);
    try {
      const tokens = await api.loginMotorista(usuario.trim(), senha);
      await saveTokens(tokens);
      setAuthState(true);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErro("Usuário ou senha incorretos.");
      } else {
        setErro((err as Error).message ?? "Falha ao entrar.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 justify-center px-6 py-8">
            <View className="mb-8">
              <Text className="text-3xl font-semibold text-foreground">Ronan</Text>
              <Text className="mt-1 text-base text-muted-foreground">
                Acesso do motorista
              </Text>
            </View>

            <View className="gap-4">
              <View className="gap-2">
                <Label>Usuário</Label>
                <Input
                  value={usuario}
                  onChangeText={setUsuario}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  placeholder="seu usuario"
                  editable={!submitting}
                />
              </View>

              <View className="gap-2">
                <Label>Senha</Label>
                <Input
                  value={senha}
                  onChangeText={setSenha}
                  secureTextEntry
                  autoComplete="password"
                  placeholder="••••••"
                  editable={!submitting}
                />
              </View>

              {erro && (
                <Text className="text-sm text-destructive">{erro}</Text>
              )}

              <Button
                size="lg"
                className="mt-2"
                loading={submitting}
                onPress={entrar}
              >
                {submitting ? "Entrando..." : "Entrar"}
              </Button>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
