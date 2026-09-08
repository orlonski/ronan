import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Image, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Share2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/screen-header";
import { API_URL } from "@/lib/api-url";
import { tokensIdentidade } from "@/lib/identidade";

/**
 * A foto do documento, em tela cheia.
 *
 * A carteira guardava e nunca devolvia: o upload funcionava, o backend tinha
 * `GET /m/eu/frete/documentos/:id/arquivo`, e o app não tinha nem cliente nem
 * tela pra ele. Ou seja, ele fotografava a CNH e depois não conseguia abrir pra
 * mandar pra quem pediu — que é a razão inteira de a carteira existir.
 *
 * O arquivo é PRIVADO de propósito (o link público do comprovante mostra que o
 * documento está em dia, nunca a imagem). Por isso a request leva o token da
 * pessoa — e o `<Image>` só monta com ele pronto: no Android o Fresco cacheia o
 * 401 da primeira tentativa e a foto fica preta pra sempre.
 */
export default function DocumentoFotoScreen() {
  const { id, titulo } = useLocalSearchParams<{ id: string; titulo?: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    void tokensIdentidade()
      .then((t) => setToken(t?.accessToken ?? null))
      .catch(() => setFalhou(true));
  }, []);

  const uri = `${API_URL}/m/eu/frete/documentos/${id}/arquivo`;

  const [baixando, setBaixando] = useState(false);

  /**
   * Baixa o arquivo pro aparelho e entrega ao menu de compartilhar do sistema.
   *
   * Mandar a URL não serviria: ela exige o token dele, então quem recebesse
   * veria um 401. O caminho é o arquivo mesmo, pelo canal que ele escolher.
   */
  async function compartilhar() {
    if (!token) return;
    setBaixando(true);
    try {
      const FileSystem = await import("expo-file-system/legacy");
      const destino = `${FileSystem.cacheDirectory}${(titulo || "documento")
        .normalize("NFD")
        .replace(/[^\w]+/g, "-")
        .toLowerCase()}.jpg`;
      const { uri: local } = await FileSystem.downloadAsync(uri, destino, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await Share.share({ url: local, message: titulo || "Documento" });
    } catch {
      setFalhou(true);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScreenHeader title={titulo || "Documento"} />

      <View className="flex-1 bg-black">
        {token && !falhou ? (
          <Image
            source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
            style={{ flex: 1 }}
            resizeMode="contain"
            onError={() => setFalhou(true)}
          />
        ) : (
          <View className="flex-1 items-center justify-center gap-3 p-6">
            {falhou ? (
              <Text className="text-center text-base text-white">
                Não deu pra abrir a foto agora. Confira sua internet e tente de novo.
              </Text>
            ) : (
              <ActivityIndicator color="white" />
            )}
          </View>
        )}
      </View>

      <View className="gap-2 p-4">
        <Button size="lg" loading={baixando} onPress={() => void compartilhar()}>
          <Share2 size={20} color="#fff" />
          <Text className="text-base font-bold text-primary-foreground">
            {baixando ? "Preparando…" : "Compartilhar"}
          </Text>
        </Button>
        <Text className="text-center text-sm text-muted-foreground">
          A foto sai do seu aparelho pelo app que você escolher — nunca por link aberto.
        </Text>
      </View>
    </SafeAreaView>
  );
}
