import { useState } from "react";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cpfDigits, telefoneDigits } from "@ronan/shared-types";
import { api, humanizeApiError } from "@/lib/api";

function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function maskCelular(input: string): string {
  const d = telefoneDigits(input).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskPlaca(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
}

export default function SignupScreen() {
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [celular, setCelular] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [placas, setPlacas] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function setPlaca(i: number, v: string) {
    setPlacas((arr) => arr.map((p, idx) => (idx === i ? maskPlaca(v) : p)));
  }
  function addPlaca() {
    setPlacas((arr) => [...arr, ""]);
  }
  function removePlaca(i: number) {
    setPlacas((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function enviar() {
    setErro(null);
    const cpfDigitos = cpfDigits(cpf);
    const celularDigitos = telefoneDigits(celular);
    const placasLimpa = placas.map((p) => p.trim()).filter(Boolean);

    if (nome.trim().length < 2) return setErro("Informe seu nome completo.");
    if (cpfDigitos.length !== 11) return setErro("CPF precisa ter 11 dígitos.");
    if (celularDigitos.length < 10) return setErro("Informe um celular válido com DDD.");
    if (senha.length < 6) return setErro("A senha precisa ter ao menos 6 caracteres.");
    if (senha !== confirmar) return setErro("As senhas não conferem.");
    if (placasLimpa.length === 0) return setErro("Informe ao menos uma placa.");

    setSubmitting(true);
    try {
      await api.iniciarCadastro({
        nome: nome.trim(),
        cpf: cpfDigitos,
        telefone: celularDigitos,
        email: email.trim() || undefined,
        senha,
        placas: placasLimpa.map((placa) => ({ placa })),
        // Primeira placa é a padrão quando há mais de uma.
        placaDefault: placasLimpa.length > 1 ? placasLimpa[0] : undefined,
      });
      router.push({
        pathname: "/signup-codigo",
        params: { cpf: cpfDigitos, celular: celularDigitos },
      });
    } catch (err) {
      setErro(humanizeApiError(err));
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
          <View className="bg-brand px-6 pb-8 pt-16">
            <Text className="text-4xl font-extrabold tracking-tight text-white">
              Criar cadastro
            </Text>
            <Text className="mt-2 text-base font-medium text-white/80">
              Preencha seus dados pra começar
            </Text>
          </View>

          <View className="flex-1 gap-5 px-6 py-7">
            <View className="gap-2">
              <Label>Nome completo</Label>
              <Input
                value={nome}
                onChangeText={setNome}
                placeholder="Seu nome"
                autoCapitalize="words"
                editable={!submitting}
              />
            </View>

            <View className="gap-2">
              <Label>CPF</Label>
              <Input
                value={cpf}
                onChangeText={(v) => setCpf(maskCpf(v))}
                keyboardType="numeric"
                placeholder="000.000.000-00"
                editable={!submitting}
              />
            </View>

            <View className="gap-2">
              <Label>Celular (WhatsApp)</Label>
              <Input
                value={celular}
                onChangeText={(v) => setCelular(maskCelular(v))}
                keyboardType="phone-pad"
                placeholder="(00) 00000-0000"
                editable={!submitting}
              />
              <Text className="text-sm text-muted-foreground">
                Vamos enviar um código de confirmação nesse número.
              </Text>
            </View>

            <View className="gap-2">
              <Label>Email (opcional)</Label>
              <Input
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="voce@email.com"
                editable={!submitting}
              />
            </View>

            <View className="gap-2">
              <Label>Placa do veículo</Label>
              {placas.map((p, i) => (
                <View key={i} className="flex-row items-center gap-2">
                  <Input
                    value={p}
                    onChangeText={(v) => setPlaca(i, v)}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="ABC1D23"
                    className="flex-1"
                    editable={!submitting}
                  />
                  {placas.length > 1 && (
                    <Button
                      variant="outline"
                      size="icon"
                      onPress={() => removePlaca(i)}
                      disabled={submitting}
                    >
                      <Text className="text-xl text-foreground">×</Text>
                    </Button>
                  )}
                </View>
              ))}
              <Pressable onPress={addPlaca} disabled={submitting} className="py-1">
                <Text className="text-base font-semibold text-brand">+ Adicionar outra placa</Text>
              </Pressable>
              {placas.filter((p) => p.trim()).length > 1 && (
                <Text className="text-sm text-muted-foreground">
                  A primeira placa será sua placa padrão.
                </Text>
              )}
            </View>

            <View className="gap-2">
              <Label>Senha</Label>
              <Input
                value={senha}
                onChangeText={setSenha}
                secureTextEntry
                placeholder="Mínimo 6 caracteres"
                editable={!submitting}
              />
            </View>

            <View className="gap-2">
              <Label>Confirmar senha</Label>
              <Input
                value={confirmar}
                onChangeText={setConfirmar}
                secureTextEntry
                placeholder="Repita a senha"
                editable={!submitting}
              />
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            <Button size="lg" className="mt-1 h-16" loading={submitting} onPress={enviar}>
              <Text className="text-lg font-bold text-primary-foreground">
                {submitting ? "Enviando..." : "Continuar"}
              </Text>
            </Button>

            <Pressable onPress={() => router.replace("/login")} disabled={submitting} className="py-2">
              <Text className="text-center text-base font-medium text-muted-foreground">
                Já tenho cadastro — entrar
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
