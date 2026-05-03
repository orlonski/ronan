import { useState } from "react";
import { router, Stack } from "expo-router";
import { ArrowLeft, KeyRound, LogOut } from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { useMe } from "@/lib/queries";

export default function Perfil() {
  const me = useMe();
  const [showChange, setShowChange] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [feedback, setFeedback] = useState<
    { type: "ok" | "err"; msg: string } | null
  >(null);
  const [loading, setLoading] = useState(false);

  async function sair() {
    await clearTokens();
    setAuthState(false);
    router.replace("/login");
  }

  async function trocarSenha() {
    setFeedback(null);
    if (!senhaAtual || !novaSenha) {
      setFeedback({ type: "err", msg: "Preencha senha atual e nova senha." });
      return;
    }
    if (novaSenha.length < 6) {
      setFeedback({ type: "err", msg: "Nova senha precisa ter ao menos 6 caracteres." });
      return;
    }
    setLoading(true);
    try {
      await api.post("/m/auth/trocar-senha", { senhaAtual, novaSenha });
      setFeedback({ type: "ok", msg: "Senha alterada." });
      setSenhaAtual("");
      setNovaSenha("");
      setShowChange(false);
    } catch (err) {
      setFeedback({
        type: "err",
        msg: (err as Error).message ?? "Erro ao trocar senha",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onPress={() => router.back()}>
          <ArrowLeft size={20} color="#0f172a" />
        </Button>
        <Text className="text-lg font-semibold text-foreground">Perfil</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <Card>
            <Row dt="Nome" dd={me.data?.nome ?? "—"} />
            <Row dt="Usuário" dd={me.data?.usuario ?? "—"} mono />
            <Row dt="Telefone" dd={me.data?.telefone ?? "—"} />
            <Row
              dt="Placa padrão"
              dd={me.data?.veiculoDefault?.placa ?? "—"}
              mono
            />
          </Card>

          {!showChange && (
            <Button
              variant="outline"
              size="lg"
              onPress={() => setShowChange(true)}
            >
              <KeyRound size={18} color="#0f172a" />
              <Text className="text-base font-medium text-foreground">
                Trocar senha
              </Text>
            </Button>
          )}

          {showChange && (
            <Card>
              <View className="gap-3">
                <View className="gap-2">
                  <Label>Senha atual</Label>
                  <Input
                    value={senhaAtual}
                    onChangeText={setSenhaAtual}
                    secureTextEntry
                    autoComplete="current-password"
                    editable={!loading}
                  />
                </View>
                <View className="gap-2">
                  <Label>Nova senha</Label>
                  <Input
                    value={novaSenha}
                    onChangeText={setNovaSenha}
                    secureTextEntry
                    autoComplete="new-password"
                    editable={!loading}
                  />
                </View>
                <View className="flex-row gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onPress={() => {
                      setShowChange(false);
                      setSenhaAtual("");
                      setNovaSenha("");
                      setFeedback(null);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className="flex-1"
                    onPress={trocarSenha}
                    loading={loading}
                  >
                    {loading ? "Salvando..." : "Salvar"}
                  </Button>
                </View>
              </View>
            </Card>
          )}

          {feedback && (
            <Text
              className={
                feedback.type === "ok"
                  ? "text-sm text-green-700"
                  : "text-sm text-destructive"
              }
            >
              {feedback.msg}
            </Text>
          )}

          <Button variant="outline" size="lg" onPress={sair}>
            <LogOut size={18} color="#dc2626" />
            <Text className="text-base font-medium text-destructive">Sair</Text>
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({ dt, dd, mono }: { dt: string; dd: string; mono?: boolean }) {
  return (
    <View className="flex-row justify-between gap-3 py-1.5">
      <Text className="text-sm text-muted-foreground">{dt}</Text>
      <Text
        className="flex-1 text-right text-sm text-foreground"
        style={mono ? { fontVariant: ["tabular-nums"] } : undefined}
        numberOfLines={1}
      >
        {dd}
      </Text>
    </View>
  );
}
