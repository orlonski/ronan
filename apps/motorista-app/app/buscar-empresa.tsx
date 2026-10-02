import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScreenHeader } from "@/components/screen-header";
import { api, humanizeApiError, type EmpresaBusca } from "@/lib/api";
import { setCadastroStatus } from "@/lib/cadastro-status";
import { guardarSessao, marcarEmpresaEscolhida } from "@/lib/sessoes";

/**
 * Ele procura a empresa pelo nome e pede pra entrar.
 *
 * Chega aqui de dois lugares: logo depois de criar a conta (`inicio=1`, quando
 * disse que roda pra uma empresa) e pela home/Convites. A empresa decide — o
 * pedido chega pra ela como "aguardando aprovação". Só aparecem as que
 * escolheram aparecer. Pedindo, ele já entra no app daquela empresa, na tela
 * "em análise", e não fica numa home de autônomo esperando.
 */
export default function BuscarEmpresaScreen() {
  const { inicio } = useLocalSearchParams<{ inicio?: string }>();
  const queryClient = useQueryClient();
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<EmpresaBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = termo.trim();
    if (q.length < 3) {
      setLista([]);
      setErro(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    timer.current = setTimeout(async () => {
      const minha = ++seq.current;
      try {
        const r = await api.buscarEmpresas(q);
        if (minha !== seq.current) return;
        setLista(r);
        setErro(null);
      } catch (e) {
        if (minha !== seq.current) return;
        setLista([]);
        setErro(humanizeApiError(e));
      } finally {
        if (minha === seq.current) setBuscando(false);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [termo]);

  async function pedir(e: EmpresaBusca) {
    setPedindo(e.id);
    setErro(null);
    try {
      const sessao = await api.pedirEntradaEmpresa(e.id);
      await guardarSessao(sessao);
      marcarEmpresaEscolhida();
      setCadastroStatus(sessao.status);
      await queryClient.invalidateQueries();
      router.replace("/");
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setPedindo(null);
    }
  }

  const semResultado = termo.trim().length >= 3 && !buscando && !erro && lista.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title="Procure sua empresa"
            subtitle="Digite o nome da transportadora pra quem você roda"
            semVoltar={inicio === "1"}
          />

          <View className="gap-4 px-5 py-6">
            <Text className="text-base leading-6 text-muted-foreground">
              A empresa recebe o seu pedido e, aceitando, você passa a lançar suas viagens
              pra ela.
            </Text>

            <Input
              value={termo}
              onChangeText={setTermo}
              placeholder="Nome da empresa"
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
            />

            {buscando && <Text className="text-sm text-muted-foreground">Procurando…</Text>}
            {erro && <Text className="text-sm text-destructive">{erro}</Text>}

            {lista.map((e) => (
              <View key={e.id} className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
                <View className="flex-row items-center gap-3">
                  <Building2 size={22} color="#0f172a" />
                  <View className="flex-1">
                    <Text className="text-lg font-bold text-foreground">{e.nome}</Text>
                    {e.local ? (
                      <Text className="text-sm text-muted-foreground">{e.local}</Text>
                    ) : null}
                  </View>
                </View>
                <Button
                  size="lg"
                  className="bg-green-600"
                  loading={pedindo === e.id}
                  disabled={pedindo !== null}
                  onPress={() => void pedir(e)}
                >
                  <Text className="text-lg font-bold text-white">Pedir pra entrar</Text>
                </Button>
              </View>
            ))}

            {semResultado && (
              <View className="gap-1">
                <Text className="text-base font-semibold text-foreground">
                  Não achei essa empresa
                </Text>
                <Text className="text-sm leading-5 text-muted-foreground">
                  Nem toda empresa aparece aqui. Peça pra ela te cadastrar pelo seu CPF — o
                  convite chega no seu app.
                </Text>
              </View>
            )}

            {inicio === "1" && (
              <Pressable onPress={() => router.replace("/")} className="py-3">
                <Text className="text-center text-base font-medium text-muted-foreground">
                  Procurar depois
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
