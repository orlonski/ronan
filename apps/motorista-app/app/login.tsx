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
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {/* Hero: faixa azul marinho com brand (status bar fica em cima) */}
          <View className="bg-brand px-6 pb-10 pt-20">
            <Text className="text-5xl font-extrabold tracking-tight text-white">
              RONAN
            </Text>
            <Text className="mt-2 text-base font-medium text-white/80">
              Aplicativo do motorista
            </Text>
          </View>

          <View className="flex-1 px-6 py-8">
            <View className="gap-5">
              <View className="gap-2">
                <Label>Usuário</Label>
                <Input
                  value={usuario}
                  onChangeText={setUsuario}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  placeholder="seu usuário"
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
                <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                  <Text className="text-base font-medium text-destructive">
                    {erro}
                  </Text>
                </View>
              )}

              <Button
                size="lg"
                className="mt-3 h-20"
                loading={submitting}
                onPress={entrar}
              >
                <Text className="text-xl font-bold text-primary-foreground">
                  {submitting ? "Entrando..." : "Entrar"}
                </Text>
              </Button>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
