import { useState, type ReactNode } from "react";
import { router, Stack } from "expo-router";
import {
  Bell,
  ChevronRight,
  HelpCircle,
  KeyRound,
  LogOut,
  MapPin,
  MessageCircle,
  User as UserIcon,
} from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
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
import { clearCadastroStatus } from "@/lib/cadastro-status";
import { setAuthState } from "@/lib/auth-state";
import { useMe, useSalvarPreferenciasNotificacao } from "@/lib/queries";
import { replayHomeTutorial } from "@/lib/home-tutorial";

export default function Perfil() {
  const me = useMe();
  const salvarPrefs = useSalvarPreferenciasNotificacao();
  const [showChange, setShowChange] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [feedback, setFeedback] = useState<
    { type: "ok" | "err"; msg: string } | null
  >(null);
  const [loading, setLoading] = useState(false);

  const aceitaPush = me.data?.aceitaPush ?? true;
  const aceitaWhatsapp = me.data?.aceitaWhatsapp ?? true;

  async function sair() {
    await clearTokens();
    await clearCadastroStatus();
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
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 22 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Dados pessoais */}
          <View className="gap-2">
            <SectionTitle>Meus dados</SectionTitle>
            <Card className="p-0">
              <View className="flex-row items-center gap-3 p-4">
                <View className="h-12 w-12 items-center justify-center rounded-full bg-secondary">
                  <UserIcon size={24} color="#13316b" />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
                    {me.data?.nome ?? "—"}
                  </Text>
                  <Text
                    className="text-sm text-muted-foreground"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {me.data?.cpf ? formatCpf(me.data.cpf) : "—"}
                    {me.data?.telefone ? ` · ${formatTelefone(me.data.telefone)}` : ""}
                  </Text>
                </View>
              </View>
              {me.data?.veiculos && me.data.veiculos.length > 0 ? (
                <View className="border-t border-border px-4 py-3">
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Placas
                  </Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {me.data.veiculos.map((v) => {
                      const ehPadrao = v.id === me.data?.veiculoDefaultId;
                      return (
                        <View
                          key={v.id}
                          className={`rounded-md px-2 py-1 ${ehPadrao ? "bg-blue-100" : "bg-muted"}`}
                        >
                          <Text
                            className={`text-sm ${ehPadrao ? "font-semibold text-blue-700" : "text-foreground"}`}
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
              ) : null}
            </Card>
          </View>

          {/* Avisos: push + WhatsApp */}
          <View className="gap-2">
            <SectionTitle>Avisos</SectionTitle>
            <Card className="p-0">
              <ToggleRow
                icon={<Bell size={20} color="#13316b" />}
                title="Notificações no celular"
                subtitle="Avisos do app: km recalculado, viagem editada, lembrete de peso."
                value={aceitaPush}
                disabled={!me.data || salvarPrefs.isPending}
                onValueChange={(v) => salvarPrefs.mutate({ aceitaPush: v })}
              />
              <View className="h-px bg-border" />
              <ToggleRow
                icon={<MessageCircle size={20} color="#13316b" />}
                title="Mensagens no WhatsApp"
                subtitle="Lembretes e avisos pelo WhatsApp (ex: peso que falta lançar)."
                value={aceitaWhatsapp}
                disabled={!me.data || salvarPrefs.isPending}
                onValueChange={(v) => salvarPrefs.mutate({ aceitaWhatsapp: v })}
              />
            </Card>
            <Text className="px-1 text-xs text-muted-foreground">
              Você pode ligar e desligar quando quiser. Mesmo desligado, os avisos
              continuam aparecendo aqui dentro do app.
            </Text>
          </View>

          {/* Conta */}
          <View className="gap-2">
            <SectionTitle>Conta</SectionTitle>
            <Card className="p-0">
              <ActionRow
                icon={<KeyRound size={20} color="#13316b" />}
                title="Trocar senha"
                onPress={() => setShowChange((s) => !s)}
              />
              <View className="h-px bg-border" />
              <ActionRow
                icon={<MapPin size={20} color="#13316b" />}
                title="Compartilhar posição"
                onPress={() => router.push("/perfil-posicao")}
              />
              {me.data ? (
                <>
                  <View className="h-px bg-border" />
                  <ActionRow
                    icon={<HelpCircle size={20} color="#13316b" />}
                    title="Rever tutorial"
                    onPress={() => {
                      router.push("/");
                      setTimeout(() => replayHomeTutorial(me.data!), 350);
                    }}
                  />
                </>
              ) : null}
            </Card>
          </View>

          {showChange && (
            <Card>
              <View className="gap-3">
                <Text className="text-base font-bold text-foreground">Trocar senha</Text>
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
                  <Button className="flex-1" onPress={trocarSenha} loading={loading}>
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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </Text>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  disabled,
  onValueChange,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-3 p-4">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        <Text className="mt-0.5 text-sm text-muted-foreground">{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: "#2563eb", false: "#cbd5e1" }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

function ActionRow({
  icon,
  title,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 p-4 active:bg-muted/50"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
        {icon}
      </View>
      <Text className="flex-1 text-base font-semibold text-foreground">{title}</Text>
      <ChevronRight size={20} color="#94a3b8" />
    </Pressable>
  );
}
