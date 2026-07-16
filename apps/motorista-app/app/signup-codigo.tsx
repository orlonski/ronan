import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCpf } from "@ronan/shared-types";
import { api, humanizeApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";

const COOLDOWN_S = 60;

function mascararCelular(c: string): string {
  // Mostra só os 4 últimos dígitos: (..) ....-1234
  const d = c.replace(/\D/g, "");
  if (d.length < 4) return c;
  return `••••-${d.slice(-4)}`;
}

export default function SignupCodigoScreen() {
  const params = useLocalSearchParams<{ cpf?: string; celular?: string }>();
  const cpf = params.cpf ?? "";
  const celular = params.celular ?? "";

  const [codigo, setCodigo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(COOLDOWN_S);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function confirmar() {
    setErro(null);
    if (codigo.trim().length !== 6) return setErro("Digite os 6 dígitos do código.");
    setSubmitting(true);
    try {
      const res = await api.confirmarCadastro({ cpf, codigo: codigo.trim() });
      await saveTokens(res);
      setAuthState(true);
      router.replace("/");
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function reenviar() {
    if (cooldown > 0) return;
    setErro(null);
    setReenviando(true);
    try {
      await api.reenviarCodigoCadastro(cpf);
      setCodigo("");
      setCooldown(COOLDOWN_S);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setReenviando(false);
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
              Confirme o código
            </Text>
            <Text className="mt-2 text-base font-medium text-white/80">
              Enviamos um código no seu WhatsApp {celular ? mascararCelular(celular) : ""}
            </Text>
          </View>

          <View className="flex-1 gap-6 px-6 py-8">
            {cpf ? (
              <Text className="text-base text-muted-foreground">
                Cadastro do CPF {formatCpf(cpf)}
              </Text>
            ) : null}

            <View className="gap-2">
              <Label>Código de 6 dígitos</Label>
              <Input
                value={codigo}
                onChangeText={(v) => setCodigo(v.replace(/\D/g, "").slice(0, 6))}
                keyboardType="numeric"
                placeholder="000000"
                className="text-center text-2xl tracking-[8px]"
                maxLength={6}
                editable={!submitting}
              />
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            <Button size="lg" className="h-16" loading={submitting} onPress={confirmar}>
              <Text className="text-lg font-bold text-primary-foreground">
                {submitting ? "Confirmando..." : "Confirmar"}
              </Text>
            </Button>

            <Pressable onPress={reenviar} disabled={cooldown > 0 || reenviando} className="py-2">
              <Text
                className={
                  cooldown > 0
                    ? "text-center text-base font-medium text-muted-foreground"
                    : "text-center text-base font-semibold text-brand"
                }
              >
                {reenviando
                  ? "Reenviando..."
                  : cooldown > 0
                    ? `Não recebi — reenviar em ${cooldown}s`
                    : "Não recebi — reenviar código"}
              </Text>
            </Pressable>

            <Pressable onPress={() => router.replace("/login")} disabled={submitting} className="py-1">
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
