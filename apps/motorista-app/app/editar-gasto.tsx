import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Trash2 } from "lucide-react-native";
import {
  ROTULO_LANCAMENTO_PESSOAL,
  TIPOS_LANCAMENTO_PESSOAL,
  type TipoLancamentoPessoal,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenHeader } from "@/components/screen-header";
import { showConfirm } from "@/lib/alert";
import { apagarLancamento, cacheDoMes, editarLancamento, type ItemPessoal } from "@/lib/pessoal";

/**
 * Corrigir (ou apagar) um gasto já lançado.
 *
 * Mesma razão do frete: sem isto, um zero a mais no valor ficava no mês pra
 * sempre. O `apagarLancamentoPessoal` já existia no cliente da API e nunca era
 * chamado por tela nenhuma — era código morto por falta desta.
 */
export default function EditarGastoScreen() {
  const { clientId, mes } = useLocalSearchParams<{ clientId: string; mes: string }>();
  const [item, setItem] = useState<ItemPessoal | null>(null);
  const [naoAchei, setNaoAchei] = useState(false);

  const [tipo, setTipo] = useState<TipoLancamentoPessoal>("ABASTECIMENTO");
  const [data, setData] = useState("");
  const [valor, setValor] = useState("");
  const [litros, setLitros] = useState("");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void (async () => {
      const achado = (await cacheDoMes(mes)).find((g) => g.clientId === clientId);
      if (!achado) return setNaoAchei(true);
      setItem(achado);
      setTipo(achado.tipo);
      setData(achado.data);
      setValor(String(achado.valor).replace(".", ","));
      setLitros(achado.litros != null ? String(achado.litros).replace(".", ",") : "");
      setDescricao(achado.descricao ?? "");
    })();
  }, [clientId, mes]);

  async function salvar() {
    if (!item) return;
    setErro(null);
    const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!valorNum || valorNum <= 0) return setErro("Informe o valor.");
    setSalvando(true);
    try {
      await editarLancamento(item, {
        tipo,
        data,
        valor: valorNum,
        // Litro só vale em abastecimento — o backend recusa o resto, e trocar o
        // tipo sem limpar o campo mandaria um lançamento que já nasce recusado.
        litros:
          tipo === "ABASTECIMENTO" && litros
            ? Number(litros.replace(",", "."))
            : undefined,
        descricao: descricao.trim() || undefined,
      });
      router.back();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!item) return;
    const ok = await showConfirm({
      title: "Apagar este lançamento?",
      message: `${ROTULO_LANCAMENTO_PESSOAL[item.tipo]} de ${item.valor.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}. Sai do seu histórico e do resumo do mês.`,
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    await apagarLancamento(item);
    router.back();
  }

  if (naoAchei) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <ScreenHeader title="Gasto" />
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-center text-base text-muted-foreground">
            Não achei esse lançamento. Puxe a lista pra baixo no Histórico e tente de novo.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader title="Corrigir gasto" subtitle="Nenhuma empresa vê isto" />

          <View className="flex-1 gap-5 px-5 py-6">
            <View className="flex-row flex-wrap gap-2">
              {TIPOS_LANCAMENTO_PESSOAL.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTipo(t)}
                  className={`rounded-xl border-2 px-4 py-3 ${
                    tipo === t ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                >
                  <Text
                    className={`text-base font-bold ${
                      tipo === t ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {ROTULO_LANCAMENTO_PESSOAL[t]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View className="gap-2">
              <Label>Valor (R$)</Label>
              <Input
                value={valor}
                onChangeText={(v) => setValor(v.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                editable={!salvando}
              />
            </View>

            {tipo === "ABASTECIMENTO" && (
              <View className="gap-2">
                <Label>Litros</Label>
                <Input
                  value={litros}
                  onChangeText={(v) => setLitros(v.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  editable={!salvando}
                />
              </View>
            )}

            <View className="gap-2">
              <Label>Observação</Label>
              <Input value={descricao} onChangeText={setDescricao} editable={!salvando} />
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            <Button size="lg" className="h-16" loading={salvando} onPress={() => void salvar()}>
              <Text className="text-lg font-bold text-primary-foreground">
                {salvando ? "Salvando..." : "Salvar"}
              </Text>
            </Button>

            <Button size="lg" variant="destructive" onPress={() => void apagar()}>
              <Trash2 size={20} color="#fff" />
              <Text className="text-base font-bold text-white">Apagar lançamento</Text>
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
