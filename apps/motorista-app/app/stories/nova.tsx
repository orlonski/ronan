import { useState } from "react";
import { router } from "expo-router";
import * as ImageManipulator from "expo-image-manipulator";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pegarCoordsRapido } from "@/lib/geo";
import { useEnviarStory } from "@/lib/queries";
import { showAlert } from "@/lib/alert";
import { MAX_LEGENDA_STORY } from "@ronan/shared-types";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function NovaStoryScreen() {
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [legenda, setLegenda] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = useEnviarStory();

  // Story é só pra ver na tela do celular — comprime bem mais leve que o ticket
  // (1080px/0.55 vs 1920/0.7) pra subir e carregar rápido no feed, inclusive em
  // 4G ruim. Roda ao escolher a foto, então publicar continua instantâneo.
  async function aoEscolherFoto(p: CapturedPhoto | null) {
    if (!p) return setFoto(null);
    try {
      const leve = await ImageManipulator.manipulateAsync(
        p.uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG },
      );
      setFoto({ uri: leve.uri, mime: "image/jpeg" });
    } catch {
      setFoto(p); // se a compressão falhar, usa a original
    }
  }

  async function publicar() {
    if (!foto || enviando) return;
    setEnviando(true);
    try {
      // GPS silencioso (best-effort, cap 2s) — contexto do trecho. Nunca trava
      // o post: se não tiver last-known na hora, vai sem coords.
      const coords = await pegarCoordsRapido().catch(() => null);
      await enviar.mutateAsync({
        clientId: uuid(),
        fotoUri: foto.uri,
        fotoMime: foto.mime,
        legenda: legenda.trim() || undefined,
        lat: coords?.lat,
        lng: coords?.lng,
      });
      router.back();
    } catch {
      setEnviando(false);
      void showAlert({
        title: "Não deu pra postar",
        message:
          "Tenta de novo. Se estiver sem sinal, o story sobe sozinho quando a internet voltar.",
      });
    }
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Postar story" />
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {foto && (
            <Text className="text-base text-muted-foreground">
              Escreva algo se quiser e publique. Some sozinha em 24 horas.
            </Text>
          )}

          <PhotoCapture
            value={foto}
            onChange={aoEscolherFoto}
            autoOpen
            hidePlaceholder
            onCancel={() => router.back()}
          />

          <View className="gap-1">
            <Input
              placeholder="Escreva algo (opcional)"
              value={legenda}
              onChangeText={(t) => setLegenda(t.slice(0, MAX_LEGENDA_STORY))}
              maxLength={MAX_LEGENDA_STORY}
              className="h-auto min-h-14 py-3"
              multiline
            />
            <Text className="text-right text-xs text-muted-foreground">
              {legenda.length}/{MAX_LEGENDA_STORY}
            </Text>
          </View>

          <Button
            variant="brand"
            size="lg"
            onPress={publicar}
            disabled={!foto || enviando}
            loading={enviando}
          >
            Publicar
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
