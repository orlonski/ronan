import { useState } from "react";
import { router } from "expo-router";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pegarCoords } from "@/lib/geo";
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

  async function publicar() {
    if (!foto || enviando) return;
    setEnviando(true);
    try {
      // GPS silencioso (best-effort) — contexto do trecho, não bloqueia o post.
      const coords = await pegarCoords().catch(() => null);
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
          <Text className="text-base text-muted-foreground">
            Tire uma foto do trecho pra mostrar pros outros motoristas. Some
            sozinha em 24 horas.
          </Text>

          <PhotoCapture value={foto} onChange={setFoto} />

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
