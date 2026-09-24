import { useEffect, useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import { Image, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { RequerCapacidade } from "@/components/requer-capacidade";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { useCatalogos, useMe } from "@/lib/queries";
import { enqueueProblemaVeiculo } from "@/lib/sync";

const MAX_FOTOS = 3;

/**
 * AVISAR PROBLEMA NO CAMINHÃO: foto e descrição do que ele viu (pneu, luz no
 * painel, barulho, vazamento). Cai em Manutenção, no painel, pro escritório
 * decidir se vira manutenção.
 *
 * Offline-first como todo lançamento: vai pra fila e sobe quando tiver sinal.
 * O texto fala de avisar, não de "reportar ocorrência": ele é parceiro, está
 * ajudando a cuidar do caminhão, não prestando contas.
 */
export default function AvisarProblemaScreen() {
  return (
    <RequerCapacidade chave="app.problema.avisar" titulo="Avisar problema">
      <Conteudo />
    </RequerCapacidade>
  );
}

function Conteudo() {
  const me = useMe();
  const cat = useCatalogos();
  const val = useValidacaoGuiada();
  const [veiculoId, setVeiculoId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [fotos, setFotos] = useState<CapturedPhoto[]>([]);
  const [enviando, setEnviando] = useState(false);

  // O caminhão dele já vem marcado, como no abastecimento — ele troca se for outro.
  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) setVeiculoId(me.data.veiculoDefaultId);
  }, [me.data?.veiculoDefaultId, veiculoId]);

  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );

  async function enviar() {
    val.limpar();
    if (veiculoOptions.length > 0 && !veiculoId) {
      return void val.apontar("veiculoId", "Escolha a placa");
    }
    if (descricao.trim().length < 3) {
      return void val.apontar("descricao", "Conte o que está acontecendo");
    }
    setEnviando(true);
    try {
      await enqueueProblemaVeiculo({
        veiculoId: veiculoId || null,
        placa: cat.data?.veiculos.find((v) => v.id === veiculoId)?.placa ?? null,
        descricao: descricao.trim(),
        fotos,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await showAlert({
        title: "Aviso guardado",
        message: "Vai pro escritório assim que tiver sinal. Obrigado por avisar.",
        buttons: [{ label: "Voltar pro início" }],
      });
      router.back();
    } catch {
      await showAlert({
        title: "Não consegui guardar o aviso",
        message: "Tente de novo. Se continuar, tire a foto outra vez.",
        variant: "warning",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Avisar problema no caminhão" />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          ref={val.scrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-base text-muted-foreground">
            Viu algo errado no caminhão? Tire uma foto e conte o que é. O escritório recebe e
            decide o conserto.
          </Text>

          {veiculoOptions.length > 0 && (
            <View className="gap-2" onLayout={val.onLayoutCampo("veiculoId")}>
              <Label error={!!val.erroDe("veiculoId")}>Placa</Label>
              <Select
                value={veiculoId}
                onChange={(v) => {
                  val.limpar();
                  setVeiculoId(v);
                }}
                options={veiculoOptions}
                placeholder="Escolha a placa"
                searchable
                error={!!val.erroDe("veiculoId")}
              />
              {val.erroDe("veiculoId") ? <ErroCampo msg={val.erroDe("veiculoId")!} /> : null}
            </View>
          )}

          <View className="gap-2" onLayout={val.onLayoutCampo("descricao")}>
            <Label error={!!val.erroDe("descricao")}>O que está acontecendo</Label>
            <TextInput
              className={`min-h-28 rounded-xl border-2 p-3 text-base text-foreground ${
                val.erroDe("descricao") ? "border-destructive" : "border-border"
              }`}
              multiline
              textAlignVertical="top"
              placeholder="Ex: pneu traseiro esquerdo careca; luz do óleo acendeu"
              value={descricao}
              onChangeText={(t) => {
                val.limpar();
                setDescricao(t);
              }}
              onFocus={() => setTimeout(() => val.scrollRef.current?.scrollToEnd({ animated: true }), 250)}
            />
            {val.erroDe("descricao") ? <ErroCampo msg={val.erroDe("descricao")!} /> : null}
          </View>

          <View className="gap-2">
            <Label>Fotos (até {MAX_FOTOS}, opcional)</Label>
            {fotos.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {fotos.map((f, i) => (
                  <View key={f.uri} className="h-24 w-24 overflow-hidden rounded-xl border-2 border-border">
                    <Image source={{ uri: f.uri }} className="h-full w-full" />
                    <Pressable
                      accessibilityLabel={`Tirar a foto ${i + 1}`}
                      onPress={() => setFotos((l) => l.filter((_, j) => j !== i))}
                      className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-black/70"
                    >
                      <X size={16} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {fotos.length < MAX_FOTOS && (
              <PhotoCapture
                // Remonta a cada foto: o componente mostra a foto que tem, e
                // aqui ele serve só pra pegar a próxima.
                key={fotos.length}
                value={null}
                onChange={(p) => {
                  if (p) setFotos((l) => [...l, p].slice(0, MAX_FOTOS));
                }}
              />
            )}
          </View>

          <Button variant="success" onPress={() => void enviar()} loading={enviando} disabled={enviando}>
            Enviar aviso
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
