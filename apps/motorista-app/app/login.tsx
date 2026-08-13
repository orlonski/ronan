import { useState } from "react";
import { router } from "expo-router";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { cpfDigits } from "@ronan/shared-types";
import { api, ApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { MovatruckLogo } from "@/components/movatruck-logo";

// Aplica máscara CPF enquanto digita.
function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function LoginScreen() {
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function entrar() {
    setErro(null);
    const cpfDigitos = cpfDigits(cpf);
    if (cpfDigitos.length !== 11 || !senha) {
      setErro("Informe o CPF (11 dígitos) e a senha");
      return;
    }
    setSubmitting(true);
    try {
      const tokens = await api.loginMotorista(cpfDigitos, senha);
      await saveTokens(tokens);
      setAuthState(true);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErro("CPF ou senha incorretos.");
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
        behavior="padding"
        className="flex-1"
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {/* Hero: faixa azul marinho com brand (status bar fica em cima) */}
          <View className="bg-brand px-6 pb-10 pt-20">
            <MovatruckLogo />
            <Text className="mt-2 text-base font-medium text-white/80">
              Aplicativo do motorista
            </Text>
          </View>

          <View className="flex-1 px-6 py-8">
            <View className="gap-5">
              <View className="gap-2">
                <Label>CPF</Label>
                <Input
                  value={cpf}
                  onChangeText={(v) => setCpf(maskCpf(v))}
                  keyboardType="numeric"
                  autoCorrect={false}
                  autoComplete="username"
                  placeholder="000.000.000-00"
                  editable={!submitting}
                />
              </View>

              <View className="gap-2">
                <Label>Senha</Label>
                <PasswordInput
                  value={senha}
                  onChangeText={setSenha}
                  autoComplete="password"
                  textContentType="password"
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

              <Pressable
                onPress={() => router.push("/esqueci-senha")}
                disabled={submitting}
                className="mt-2 py-2"
              >
                <Text className="text-center text-base font-semibold text-brand">
                  Esqueci minha senha
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/signup")}
                disabled={submitting}
                className="py-2"
              >
                <Text className="text-center text-base font-semibold text-brand">
                  Não tem cadastro? Criar agora
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
