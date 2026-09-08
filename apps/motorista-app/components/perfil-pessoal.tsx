import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FileText, KeyRound, LogOut, Truck, User } from "lucide-react-native";
import { formatCpf, formatTelefone } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type MeuPerfil } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { clearCadastroStatus } from "@/lib/cadastro-status";
import { showAlert, showConfirm } from "@/lib/alert";

/**
 * O perfil de quem trabalha por conta própria.
 *
 * O perfil da empresa mostra o que ELA liberou pra ele (flags, resumo diário,
 * preferências de aviso). Aqui não há empresa: o que existe é ele — os dados,
 * as placas, os documentos e a senha, que sempre foi da pessoa.
 */
export function PerfilPessoal() {
  const [perfil, setPerfil] = useState<MeuPerfil | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [salvando, setSalvando] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setPerfil(await api.meuPerfil());
    } catch {
      /* sem sinal: fica o que já está na tela */
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  async function trocarSenha() {
    if (novaSenha.length < 6) {
      void showAlert({ title: "Senha muito curta", message: "Use pelo menos 6 caracteres." });
      return;
    }
    setSalvando(true);
    try {
      await api.trocarSenhaPessoa(senhaAtual, novaSenha);
      setSenhaAtual("");
      setNovaSenha("");
      setTrocando(false);
      void showAlert({ title: "Senha trocada", message: "Use a nova da próxima vez que entrar." });
    } catch (e) {
      void showAlert({ title: "Não deu pra trocar", message: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  async function sair() {
    const ok = await showConfirm({
      title: "Sair do app?",
      message: "Seus fretes e documentos continuam guardados — é só entrar de novo.",
      confirmLabel: "Sair",
    });
    if (!ok) return;
    await clearTokens();
    await clearCadastroStatus();
    setAuthState(false);
    router.replace("/login");
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={carregando} onRefresh={() => void recarregar()} />
        }
      >
        <Text className="mb-1 text-2xl font-extrabold tracking-tight text-foreground">Perfil</Text>

        <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <User size={26} color="#13316b" />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-foreground">{perfil?.nome ?? "—"}</Text>
              <Text className="text-sm text-muted-foreground">
                {perfil ? formatCpf(perfil.cpf) : ""}
                {perfil?.telefone ? ` · ${formatTelefone(perfil.telefone)}` : ""}
              </Text>
            </View>
          </View>

          {perfil && perfil.placas.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-2">
              <Truck size={16} color="#64748b" />
              {perfil.placas.map((p) => (
                <View key={p.placa} className="rounded-lg bg-secondary px-2 py-1">
                  <Text className="font-mono text-sm font-bold text-foreground">{p.placa}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Pressable
          onPress={() => router.push("/meus-documentos")}
          className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
        >
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <FileText size={26} color="#13316b" strokeWidth={2.5} />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-foreground">Meus documentos</Text>
            <Text className="text-sm text-muted-foreground">
              CNH, toxicológico, RNTRC, CRLV
            </Text>
          </View>
        </Pressable>

        {trocando ? (
          <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
            <Text className="text-lg font-bold text-foreground">Trocar senha</Text>
            <View className="gap-2">
              <Label>Senha atual</Label>
              <Input
                value={senhaAtual}
                onChangeText={setSenhaAtual}
                secureTextEntry
                editable={!salvando}
              />
            </View>
            <View className="gap-2">
              <Label>Nova senha</Label>
              <Input
                value={novaSenha}
                onChangeText={setNovaSenha}
                secureTextEntry
                editable={!salvando}
              />
            </View>
            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => setTrocando(false)}
                disabled={salvando}
              >
                <Text className="text-base font-semibold text-foreground">Cancelar</Text>
              </Button>
              <Button className="flex-1 bg-green-600" loading={salvando} onPress={trocarSenha}>
                <Text className="text-base font-bold text-white">Salvar</Text>
              </Button>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setTrocando(true)}
            className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
          >
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <KeyRound size={26} color="#13316b" strokeWidth={2.5} />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-foreground">Trocar senha</Text>
              <Text className="text-sm text-muted-foreground">
                A senha é sua, vale em qualquer empresa que você entrar
              </Text>
            </View>
          </Pressable>
        )}

        <Button size="lg" variant="outline" onPress={() => void sair()}>
          <LogOut size={20} color="#0f172a" />
          <Text className="text-base font-semibold text-foreground">Sair</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
