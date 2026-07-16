import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
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
import { Label } from "@/components/ui/label";
import { cpfDigits, maskTelefone, telefoneDigits } from "@ronan/shared-types";
import { api, apiErrorCode, humanizeApiError } from "@/lib/api";

// Aplica máscara CPF enquanto digita.
function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function EsqueciSenhaScreen() {
  // Pode chegar com o CPF já preenchido (ex: veio da tela de cadastro que
  // detectou "CPF já tem cadastro").
  const params = useLocalSearchParams<{ cpf?: string }>();
  const [cpf, setCpf] = useState(() => (params.cpf ? maskCpf(params.cpf) : ""));
  const [celular, setCelular] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroCode, setErroCode] = useState<string | null>(null);

  async function enviar() {
    setErro(null);
    setErroCode(null);
    const cpfDigitos = cpfDigits(cpf);
    const celularDigitos = telefoneDigits(celular);
    if (cpfDigitos.length !== 11) return setErro("Informe o CPF (11 dígitos).");
    if (celularDigitos.length < 10) return setErro("Informe o celular com DDD.");
    setSubmitting(true);
    try {
      await api.esqueciSenha(cpfDigitos, celularDigitos);
      router.push({
        pathname: "/esqueci-senha-codigo",
        params: { cpf: cpfDigitos, celular: celularDigitos },
      });
    } catch (err) {
      setErro(humanizeApiError(err));
      setErroCode(apiErrorCode(err));
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
          <View className="bg-brand px-6 pb-8 pt-16">
            <Text className="text-4xl font-extrabold tracking-tight text-white">
              Esqueci minha senha
            </Text>
            <Text className="mt-2 text-base font-medium text-white/80">
              Vamos enviar um código no seu WhatsApp pra você criar uma senha nova.
            </Text>
          </View>

          <View className="flex-1 gap-5 px-6 py-8">
            <View className="gap-2">
              <Label>CPF</Label>
              <Input
                value={cpf}
                onChangeText={(v) => setCpf(maskCpf(v))}
                keyboardType="numeric"
                autoCorrect={false}
                placeholder="000.000.000-00"
                editable={!submitting}
              />
            </View>

            <View className="gap-2">
              <Label>Celular (WhatsApp)</Label>
              <Input
                value={celular}
                onChangeText={(v) => setCelular(maskTelefone(v))}
                keyboardType="numeric"
                autoCorrect={false}
                placeholder="(00) 00000-0000"
                editable={!submitting}
              />
              <Text className="text-sm text-muted-foreground">
                Use o mesmo celular do seu cadastro. O código vai pra esse número.
              </Text>
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
                {erroCode === "CPF_NAO_CADASTRADO" && (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: "/signup", params: { cpf: cpfDigits(cpf) } })
                    }
                    disabled={submitting}
                    className="mt-2"
                  >
                    <Text className="text-base font-bold text-destructive underline">
                      Fazer meu cadastro →
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            <Button size="lg" className="mt-2 h-16" loading={submitting} onPress={enviar}>
              <Text className="text-lg font-bold text-primary-foreground">
                {submitting ? "Enviando..." : "Enviar código"}
              </Text>
            </Button>

            <Pressable
              onPress={() => router.replace("/login")}
              disabled={submitting}
              className="py-1"
            >
              <Text className="text-center text-base font-medium text-muted-foreground">
                Voltar pro login
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
