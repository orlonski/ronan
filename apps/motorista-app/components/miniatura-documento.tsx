import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { FileText, X } from "lucide-react-native";
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
}: {
  exigenciaId: string;
  mimetype: string | null;
  titulo: string;
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

  const uri = `${API_URL}/m/admissao/documentos/${exigenciaId}/arquivo`;
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
            source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
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
                source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
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
