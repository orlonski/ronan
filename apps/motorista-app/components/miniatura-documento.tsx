import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { CloudUpload, FileText, X } from "lucide-react-native";
import { API_URL } from "@/lib/api-url";
import { motoristaAtivoId, tokensDe } from "@/lib/sessoes";

/**
 * O QUE ELE MANDOU, na tela.
 *
 * ⚠️ Existe porque a lista dizia "Chegou no escritório" e não mostrava NADA.
 * O motorista tirava a foto, o app confirmava, e ele ficava sem saber qual das
 * quatro tentativas entrou — nem se mandou a CNH no lugar do comprovante de
 * endereço. Sem ver, "chegou" é uma afirmação que ele tem que acreditar.
 *
 * Miniatura ruim é melhor que nada: ela não precisa dar pra ler o documento,
 * precisa dar pra RECONHECER qual é. Quem quiser conferir de perto toca e abre
 * grande.
 *
 * ⚠️ `<Image>` com header de auth só pode montar com o token PRONTO. Montar
 * antes faz o Fresco (Android) cachear o 401, e a imagem fica preta pra sempre
 * — mesmo depois que o token chega. Por isso o `token &&`.
 */
export function MiniaturaDocumento({
  exigenciaId,
  mimetype,
  titulo,
  versao,
  uriLocal,
  enviando,
}: {
  exigenciaId: string;
  mimetype: string | null;
  titulo: string;
  /** Hash curto do arquivo: entra na URL pra o cache não servir foto trocada. */
  versao?: string | null;
  /**
   * A foto que ele ACABOU de escolher, ainda na fila do aparelho.
   *
   * ⚠️ Quando existe, ela vence a do servidor. Enquanto não existia, trocar a
   * foto mostrava a ANTIGA até o envio terminar — e quem troca a foto troca
   * porque a primeira saiu tremida. Ver a tremida ali é o app dizendo que não
   * recebeu: ele manda de novo, e de novo.
   *
   * De quebra é instantânea e não gasta dado nenhum: o arquivo está no
   * aparelho.
   */
  uriLocal?: string | null;
  /** Está subindo agora (spinner) ou esperando sinal (nuvem). */
  enviando?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const dono = await motoristaAtivoId();
      const t = dono ? await tokensDe(dono) : null;
      if (vivo) setToken(t?.accessToken ?? null);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const v = versao ? `&v=${versao}` : "";
  /**
   * ⚠️ Duas URLs, e a diferença é o 4G do motorista.
   *
   * A lista usa a MINIATURA (~15 KB). Sem ela, abrir a tela com doze
   * documentos baixava o arquivo inteiro de cada um — 15 a 25 MB do pacote
   * dele — pra desenhar 64 pixels. O original só é baixado quando ele TOCA
   * pra ver de perto, que é uma decisão dele.
   */
  const uriMini = `${API_URL}/m/admissao/documentos/${exigenciaId}/arquivo?mini=1${v}`;
  const uriCheia = `${API_URL}/m/admissao/documentos/${exigenciaId}/arquivo?full=1${v}`;
  const ehImagem = (mimetype ?? "").startsWith("image/");

  // Arquivo de computador não vira miniatura, e inventar uma capa falsa seria
  // pior: ele acharia que é a foto dele.
  if (!ehImagem) {
    return (
      <View className="h-20 w-16 items-center justify-center rounded-lg border-2 border-border bg-muted">
        <FileText size={22} color="#6b7280" />
        <Text className="mt-0.5 text-[10px] font-semibold text-muted-foreground">PDF</Text>
      </View>
    );
  }

  if (falhou) {
    return (
      <View className="h-20 w-16 items-center justify-center rounded-lg border-2 border-border bg-muted">
        <FileText size={22} color="#9ca3af" />
      </View>
    );
  }

  // A foto que está na fila: mostra JÁ, com o selo de que ainda está indo.
  if (uriLocal) {
    return (
      <View className="h-20 w-16 overflow-hidden rounded-lg border-2 border-warning bg-muted">
        <Image
          source={{ uri: uriLocal }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
        <View className="absolute inset-0 items-center justify-center bg-black/35">
          {enviando ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <CloudUpload size={20} color="#fff" />
          )}
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ver ${titulo} de perto`}
        onPress={() => setAberta(true)}
        className="h-20 w-16 overflow-hidden rounded-lg border-2 border-border bg-muted active:opacity-70"
      >
        {token ? (
          <Image
            source={{ uri: uriMini, headers: { Authorization: `Bearer ${token}` } }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
            onError={() => setFalhou(true)}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" />
          </View>
        )}
      </Pressable>

      {/* Ver de perto. `SafeAreaProvider` próprio porque `Modal` abre uma
          janela separada e os insets do provider do app não chegam lá. */}
      <Modal visible={aberta} animationType="fade" onRequestClose={() => setAberta(false)}>
        <SafeAreaProvider>
          <SafeAreaView className="flex-1 bg-black" edges={["top", "bottom"]}>
            <View className="flex-row items-center justify-between px-4 py-3">
              <Text className="flex-1 text-lg font-semibold text-white" numberOfLines={1}>
                {titulo}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar"
                onPress={() => setAberta(false)}
                className="p-2"
              >
                <X size={26} color="#fff" />
              </Pressable>
            </View>
            {token ? (
              <Image
                source={{ uri: uriCheia, headers: { Authorization: `Bearer ${token}` } }}
                style={{ flex: 1 }}
                resizeMode="contain"
                onError={() => setFalhou(true)}
              />
            ) : (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}
