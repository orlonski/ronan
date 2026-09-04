import { useState } from "react";
import { router } from "expo-router";
import * as ImageManipulator from "expo-image-manipulator";
import { Send, Type, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
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
  const insets = useSafeAreaInsets();
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [legenda, setLegenda] = useState("");
  const [escrevendo, setEscrevendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const enviar = useEnviarStory();

  // Story é só pra ver na tela do celular — comprime bem mais leve que o ticket
  // (1080px/0.55 vs 1920/0.7) pra subir e carregar rápido, inclusive em 4G ruim.
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
      setFoto(p);
    }
  }

  async function publicar() {
    if (!foto || enviando) return;
    setEnviando(true);
    try {
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

  // Enquanto não tem foto: a câmera do PhotoCapture abre sozinha (autoOpen).
  // Atrás dela, tela preta com spinner (aparece no instante entre capturar e
  // comprimir). Cancelou a câmera → volta pra home.
  if (!foto) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <ActivityIndicator color="white" />
        <PhotoCapture
          value={null}
          onChange={aoEscolherFoto}
          autoOpen
          hidePlaceholder
          permitirGaleria={false}
          onCancel={() => router.back()}
        />
      </View>
    );
  }

  // Tela de compor estilo Instagram: foto em tela cheia + texto por cima.
  return (
    <View className="flex-1 bg-black">
      <Image source={{ uri: foto.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />

      {/* Barra superior */}
      <View
        pointerEvents="box-none"
        style={{ paddingTop: insets.top + 8 }}
        className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-3"
      >
        <Pressable
          onPress={() => {
            setLegenda("");
            setFoto(null); // volta pra câmera (remonta o PhotoCapture)
          }}
          className="h-11 w-11 items-center justify-center rounded-full bg-black/40 active:bg-black/60"
        >
          <X size={24} color="white" />
        </Pressable>
        {!escrevendo && (
          <Pressable
            onPress={() => setEscrevendo(true)}
            className="h-11 flex-row items-center gap-2 rounded-full bg-black/40 px-4 active:bg-black/60"
          >
            <Type size={20} color="white" />
            <Text className="font-semibold text-white">
              {legenda ? "Editar texto" : "Escrever"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Texto sobreposto (quando não está editando) — toca pra editar */}
      {!escrevendo && legenda ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-0 items-center justify-center px-8"
        >
          <Pressable onPress={() => setEscrevendo(true)}>
            <Text style={styles.overlayText}>{legenda}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Editor de texto: fundo escurecido + input central com autofoco */}
      {escrevendo && (
        <Pressable
          onPress={() => setEscrevendo(false)}
          className="absolute inset-0 items-center justify-center bg-black/50 px-6"
        >
          <TextInput
            autoFocus
            multiline
            value={legenda}
            onChangeText={(t) => setLegenda(t.slice(0, MAX_LEGENDA_STORY))}
            onBlur={() => setEscrevendo(false)}
            onSubmitEditing={() => setEscrevendo(false)}
            placeholder="Escreva algo…"
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={styles.overlayText}
            className="w-full"
          />
          <Text className="mt-4 text-xs text-white/60">
            Toque fora pra concluir · {legenda.length}/{MAX_LEGENDA_STORY}
          </Text>
        </Pressable>
      )}

      {/* Botão enviar "Seu story" */}
      {!escrevendo && (
        <View
          pointerEvents="box-none"
          style={{ paddingBottom: insets.bottom + 14 }}
          className="absolute bottom-0 left-0 right-0 flex-row justify-end px-4"
        >
          <Pressable
            onPress={publicar}
            disabled={enviando}
            className="h-14 flex-row items-center gap-2 rounded-full bg-primary pl-5 pr-4 active:opacity-80"
          >
            <Text className="text-base font-bold text-white">Seu story</Text>
            {enviando ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <View className="h-9 w-9 items-center justify-center rounded-full bg-white/25">
                <Send size={18} color="white" />
              </View>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlayText: {
    color: "white",
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
