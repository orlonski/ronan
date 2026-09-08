import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, LogOut, RefreshCw, Wallet } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { api, type ConviteEmpresa } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { clearCadastroStatus, setCadastroStatus } from "@/lib/cadastro-status";
import { marcarEmpresaEscolhida, guardarSessao } from "@/lib/sessoes";
import { showAlert, showConfirm } from "@/lib/alert";
import { MovatruckLogo } from "./movatruck-logo";

/**
 * Cobre o app inteiro quando ele tem cadastro mas não está em empresa nenhuma.
 *
 * Não é uma tela de erro: é o estado normal de quem acabou de se cadastrar. O
 * app é dele antes de ser de qualquer transportadora — o que falta é uma
 * empresa dizer "vem rodar comigo", e é isso que aparece aqui quando chega.
 *
 * A entrada é sempre por convite: ele não procura empresa nem digita código.
 * Ver docs/identidade-motorista.md.
 */
export function SemEmpresa() {
  const queryClient = useQueryClient();
  const [aceitando, setAceitando] = useState<string | null>(null);

  const convites = useQuery({
    queryKey: ["m", "eu", "convites"],
    queryFn: () => api.meusConvites(),
    // Sem cache-first aqui: convite é coisa nova por definição, e esta tela só
    // aparece pra quem está esperando um.
    staleTime: 0,
  });

  const aceitar = useCallback(
    async (c: ConviteEmpresa) => {
      setAceitando(c.motoristaId);
      try {
        const sessao = await api.aceitarConvite(c.motoristaId);
        await guardarSessao(sessao);
        marcarEmpresaEscolhida();
        setCadastroStatus(sessao.status);
        await queryClient.invalidateQueries();
        router.replace("/");
      } catch (err) {
        void showAlert({
          title: "Não deu pra aceitar",
          message: (err as Error).message,
        });
      } finally {
        setAceitando(null);
      }
    },
    [queryClient],
  );

  const recusar = useCallback(
    async (c: ConviteEmpresa) => {
      const ok = await showConfirm({
        title: `Recusar a ${c.contaNome}?`,
        message: "Ela não vai poder te ver no sistema. Se mudar de ideia, peça um convite novo.",
        confirmLabel: "Recusar convite",
        destructive: true,
      });
      if (!ok) return;
      await api.recusarConvite(c.motoristaId).catch(() => {});
      await convites.refetch();
    },
    [convites],
  );

  async function sair() {
    // `clearTokens` já esquece a sessão da pessoa junto (ver lib/auth.ts).
    await clearTokens();
    await clearCadastroStatus();
    setAuthState(false);
    router.replace("/login");
  }

  const lista = convites.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={convites.isFetching} onRefresh={() => convites.refetch()} />
        }
      >
        <View className="bg-brand px-6 pb-10 pt-20">
          <MovatruckLogo />
          <Text className="mt-2 text-base font-medium text-white/80">
            Seu cadastro está pronto
          </Text>
        </View>

        <View className="flex-1 gap-6 px-6 py-8">
          {lista.length > 0 ? (
            <View className="gap-4">
              <Text className="text-2xl font-bold text-foreground">
                {lista.length === 1 ? "Uma empresa te chamou" : "Empresas te chamaram"}
              </Text>
              {lista.map((c) => (
                <View key={c.motoristaId} className="gap-3 rounded-2xl border-2 border-border bg-card p-5">
                  <View className="flex-row items-center gap-3">
                    <Building2 size={22} color="#0f172a" />
                    <Text className="flex-1 text-xl font-bold text-foreground">{c.contaNome}</Text>
                  </View>
                  <Text className="text-base text-muted-foreground">
                    Aceitando, você passa a lançar suas viagens pra ela e ela enxerga o que você
                    rodar. Enquanto não aceitar, ela não vê nada seu.
                  </Text>
                  <Button
                    size="lg"
                    className="bg-green-600"
                    loading={aceitando === c.motoristaId}
                    onPress={() => void aceitar(c)}
                  >
                    <Text className="text-lg font-bold text-white">
                      Rodar pra {c.contaNome}
                    </Text>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    disabled={aceitando !== null}
                    onPress={() => void recusar(c)}
                  >
                    <Text className="text-base font-semibold text-foreground">Recusar</Text>
                  </Button>
                </View>
              ))}
            </View>
          ) : (
            <View className="gap-3">
              <Text className="text-2xl font-bold text-foreground">
                Falta você entrar numa empresa
              </Text>
              <Text className="text-base leading-6 text-muted-foreground">
                Seu cadastro já está feito e é seu. Pra começar a lançar viagens, uma
                transportadora precisa te adicionar — passe o seu CPF pra ela.
              </Text>
              <Text className="text-base leading-6 text-muted-foreground">
                Quando ela fizer isso, o convite aparece aqui pra você aceitar.
              </Text>
            </View>
          )}

          {/* O caderninho é dele e existe antes de qualquer empresa — é o que dá
              o que fazer no app enquanto ninguém o chamou. */}
          <Pressable
            onPress={() => router.push("/meus-gastos")}
            className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
          >
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Wallet size={26} color="#13316b" strokeWidth={2.5} />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-foreground">Meu caderno</Text>
              <Text className="text-sm text-muted-foreground">
                Veja se um frete vale a pena e anote o que rodou
              </Text>
            </View>
          </Pressable>

          <View className="gap-3">
            <Button
              size="lg"
              variant="outline"
              loading={convites.isFetching}
              onPress={() => convites.refetch()}
            >
              <RefreshCw size={20} color="#0f172a" />
              <Text className="text-lg font-semibold text-foreground">
                {convites.isFetching ? "Verificando..." : "Verificar convites"}
              </Text>
            </Button>
            <Button size="lg" variant="outline" onPress={sair}>
              <LogOut size={20} color="#0f172a" />
              <Text className="text-lg font-semibold text-foreground">Sair</Text>
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
