import { useState } from "react";
import { router, Stack } from "expo-router";
import { KeyRound, LogOut, MapPin } from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCpf, formatTelefone } from "@ronan/shared-types";
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
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader title="Perfil" />

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
            <Row dt="CPF" dd={me.data?.cpf ? formatCpf(me.data.cpf) : "—"} mono />
            <Row dt="Telefone" dd={me.data?.telefone ? formatTelefone(me.data.telefone) : "—"} />
            {me.data?.veiculos && me.data.veiculos.length > 0 ? (
              <View className="py-1.5">
                <Text className="text-sm text-muted-foreground">Placas</Text>
                <View className="mt-1 flex-row flex-wrap gap-1.5">
                  {me.data.veiculos.map((v) => {
                    const ehPadrao = v.id === me.data?.veiculoDefaultId;
                    return (
                      <View
                        key={v.id}
                        className={`rounded px-2 py-0.5 ${
                          ehPadrao ? "bg-blue-100" : "bg-muted"
                        }`}
                      >
                        <Text
                          className={`text-sm ${
                            ehPadrao ? "font-medium text-blue-700" : "text-foreground"
                          }`}
                          style={{ fontVariant: ["tabular-nums"] }}
                        >
                          {v.placa}
                          {ehPadrao ? " · padrão" : ""}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : (
              <Row dt="Placas" dd="—" />
            )}
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

          <Button
            variant="outline"
            size="lg"
            onPress={() => router.push("/perfil-posicao")}
          >
            <MapPin size={18} color="#0f172a" />
            <Text className="text-base font-medium text-foreground">
              Compartilhar posição
            </Text>
          </Button>

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
