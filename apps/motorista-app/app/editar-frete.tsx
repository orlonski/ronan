import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenHeader } from "@/components/screen-header";
import { showConfirm } from "@/lib/alert";
import {
  apagarViagem,
  cacheViagens,
  editarViagemPessoal,
  type ItemViagem,
} from "@/lib/pessoal";

/**
 * Corrigir (ou apagar) um frete já registrado.
 *
 * Existe porque o histórico era uma vitrine: um valor digitado errado — 13.000
 * no lugar de 1.300 — envenenava o mês pra sempre, e ia junto no comprovante
 * que ele manda pra quem paga. E porque o frete que nasce do GPS guiado chega
 * aqui sem valor, esperando o número que só ele sabe.
 *
 * O item vem pelo `clientId` (o id local, que existe mesmo antes de subir) e é
 * relido do cache do mês — passar o objeto inteiro pela URL quebraria assim que
 * o frete tivesse uma observação com acento.
 */
export default function EditarFreteScreen() {
  const { clientId, mes } = useLocalSearchParams<{ clientId: string; mes: string }>();
  const [item, setItem] = useState<ItemViagem | null>(null);
  const [naoAchei, setNaoAchei] = useState(false);

  const [data, setData] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [carga, setCarga] = useState("");
  const [km, setKm] = useState("");
  const [peso, setPeso] = useState("");
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void (async () => {
      const achado = (await cacheViagens(mes)).find((v) => v.clientId === clientId);
      if (!achado) return setNaoAchei(true);
      setItem(achado);
      setData(achado.data);
      setOrigem(achado.origem);
      setDestino(achado.destino);
      setCarga(achado.carga ?? "");
      setKm(achado.km != null ? String(achado.km).replace(".", ",") : "");
      setPeso(achado.peso != null ? String(achado.peso).replace(".", ",") : "");
      setValor(
        achado.valorRecebido != null ? String(achado.valorRecebido).replace(".", ",") : "",
      );
      setObservacao(achado.observacao ?? "");
    })();
  }, [clientId, mes]);

  const numero = (v: string) => {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return n > 0 ? n : undefined;
  };

  async function salvar() {
    if (!item) return;
    setErro(null);
    if (origem.trim().length < 2) return setErro("De onde você saiu?");
    if (destino.trim().length < 2) return setErro("Pra onde você levou?");
    setSalvando(true);
    try {
      await editarViagemPessoal(item, {
        data,
        origem: origem.trim(),
        destino: destino.trim(),
        carga: carga.trim() || undefined,
        km: numero(km),
        peso: numero(peso),
        valorRecebido: numero(valor),
        observacao: observacao.trim() || undefined,
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
      title: "Apagar este frete?",
      message: `${item.origem} → ${item.destino}. Ele sai do seu histórico e do seu resumo do mês.`,
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    await apagarViagem(item);
    router.back();
  }

  if (naoAchei) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <ScreenHeader title="Frete" />
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-center text-base text-muted-foreground">
            Não achei esse frete. Puxe a lista pra baixo no Histórico e tente de novo.
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
          <ScreenHeader title="Corrigir frete" subtitle="Nenhuma empresa vê isto" />

          <View className="flex-1 gap-5 px-5 py-6">
            {item.valorRecebido == null && (
              <View className="rounded-2xl border-2 border-warning bg-warning/10 p-4">
                <Text className="text-base font-bold text-foreground">Falta o valor</Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Sem ele, este frete entra como R$ 0 no "sobrou" do seu mês.
                </Text>
              </View>
            )}

            <View className="gap-2">
              <Label>De onde você saiu</Label>
              <Input value={origem} onChangeText={setOrigem} editable={!salvando} />
            </View>

            <View className="gap-2">
              <Label>Pra onde levou</Label>
              <Input value={destino} onChangeText={setDestino} editable={!salvando} />
            </View>

            <View className="gap-2">
              <Label>Quanto você recebe (R$)</Label>
              <Input
                value={valor}
                onChangeText={(v) => setValor(v.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="0,00"
                editable={!salvando}
              />
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1 gap-2">
                <Label>Km</Label>
                <Input
                  value={km}
                  onChangeText={(v) => setKm(v.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  editable={!salvando}
                />
              </View>
              <View className="flex-1 gap-2">
                <Label>Peso (t)</Label>
                <Input
                  value={peso}
                  onChangeText={(v) => setPeso(v.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  editable={!salvando}
                />
              </View>
            </View>

            <View className="gap-2">
              <Label>O que você levou</Label>
              <Input
                value={carga}
                onChangeText={setCarga}
                placeholder="Areia, brita, mudança…"
                editable={!salvando}
              />
            </View>

            <View className="gap-2">
              <Label>Observação</Label>
              <Input value={observacao} onChangeText={setObservacao} editable={!salvando} />
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
              <Text className="text-base font-bold text-white">Apagar frete</Text>
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
