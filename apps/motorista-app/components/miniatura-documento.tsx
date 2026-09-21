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
  semSelo,
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
  /**
   * Sem véu nem ícone: a foto já subiu e só falta o servidor confirmar. Nada
   * está acontecendo que ele precise saber, e piscar um selo aqui seria
   * inventar uma etapa.
   */
  semSelo?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberta, setAberta] = useState(false);
  /**
   * Quantas vezes já tentamos buscar esta imagem.
   *
   * ⚠️ O token de acesso dura 15 minutos e é lido UMA vez. Com a tela aberta
   * mais que isso, a imagem levava 401 — e uma falha bastava pra virar quadrado
   * cinza pra sempre. Agora a primeira falha busca o token de novo e tenta mais
   * uma; o número entra na URL porque `Image` com a mesma origem não refaz o
   * pedido.
   */
  const [tentativa, setTentativa] = useState(0);

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
  }, [tentativa]);

  const v = versao ? `&v=${versao}` : "";
  /**
   * ⚠️ Duas URLs, e a diferença é o 4G do motorista.
   *
   * A lista usa a MINIATURA (~15 KB). Sem ela, abrir a tela com doze
   * documentos baixava o arquivo inteiro de cada um — 15 a 25 MB do pacote
   * dele — pra desenhar 64 pixels. O original só é baixado quando ele TOCA
   * pra ver de perto, que é uma decisão dele.
   */
  const t = tentativa ? `&t=${tentativa}` : "";
  const uriMini = `${API_URL}/m/admissao/documentos/${exigenciaId}/arquivo?mini=1${v}${t}`;
  const uriCheia = `${API_URL}/m/admissao/documentos/${exigenciaId}/arquivo?full=1${v}`;
  const ehImagem = (mimetype ?? "").startsWith("image/");

  /**
   * Documento novo, tentativa nova: a desistência não é herdada.
   *
   * ⚠️ `falhou` era eterno. Uma falha qualquer — 401 de token vencido, rede que
   * caiu no meio — deixava o quadrado cinza até fechar a tela, mesmo depois de
   * o motorista mandar outra foto. O cinza dizia "não tem nada aqui" sobre um
   * arquivo que estava lá.
   */
  useEffect(() => {
    setFalhou(false);
  }, [exigenciaId, versao]);

  /** O selo do que ainda está indo. Vale pra foto e pra PDF. */
  const selo =
    semSelo ? null : (
      <View className="absolute inset-0 items-center justify-center bg-black/35">
        {enviando ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <CloudUpload size={20} color="#fff" />
        )}
      </View>
    );

  // Arquivo de computador não vira miniatura, e inventar uma capa falsa seria
  // pior: ele acharia que é a foto dele. O selo continua valendo — PDF na fila
  // também está indo, e sem o selo a tela não diz isso.
  if (!ehImagem) {
    return (
      <View className="h-20 w-16 items-center justify-center overflow-hidden rounded-lg border-2 border-border bg-muted">
        <FileText size={22} color="#6b7280" />
        <Text className="mt-0.5 text-[10px] font-semibold text-muted-foreground">PDF</Text>
        {uriLocal ? selo : null}
      </View>
    );
  }

  /**
   * A FOTO DELE VEM PRIMEIRO, antes de qualquer desistência.
   *
   * ⚠️ O teste de `falhou` ficava acima deste bloco, então uma falha de rede
   * ao buscar a miniatura do servidor escondia também a foto que ele tinha
   * ACABADO de tirar, que está no aparelho e não depende de rede nenhuma.
   *
   * Toca e abre grande, do arquivo local: de perto sem baixar nada.
   */
  if (uriLocal) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ver ${titulo} de perto`}
          onPress={() => setAberta(true)}
          className={`h-20 w-16 overflow-hidden rounded-lg border-2 bg-muted active:opacity-70 ${
            semSelo ? "border-border" : "border-warning"
          }`}
        >
          <Image
            source={{ uri: uriLocal }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
          {selo}
        </Pressable>
        <VerDePerto
          titulo={titulo}
          aberta={aberta}
          fechar={() => setAberta(false)}
          source={{ uri: uriLocal }}
        />
      </>
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
            source={{ uri: uriMini, headers: { Authorization: `Bearer ${token}` } }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
            // Primeira falha: busca o token de novo e tenta mais uma vez. Só
            // depois desiste — token vencido é o motivo mais comum, e é o que
            // some sozinho.
            onError={() => (tentativa === 0 ? setTentativa(1) : setFalhou(true))}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" />
          </View>
        )}
      </Pressable>

      <VerDePerto
        titulo={titulo}
        aberta={aberta}
        fechar={() => setAberta(false)}
        source={
          token ? { uri: uriCheia, headers: { Authorization: `Bearer ${token}` } } : null
        }
      />
    </>
  );
}

/**
 * O documento em tela cheia.
 *
 * ⚠️ `SafeAreaProvider` PRÓPRIO: `Modal` abre uma janela separada e os insets
 * do provider do app não chegam lá — sem isto o título fica atrás da Dynamic
 * Island, que foi o que apareceu no iPhone.
 */
function VerDePerto({
  titulo,
  aberta,
  fechar,
  source,
}: {
  titulo: string;
  aberta: boolean;
  fechar: () => void;
  /** Nulo enquanto o token não chegou; o arquivo local nunca precisa dele. */
  source: { uri: string; headers?: Record<string, string> } | null;
}) {
  return (
    <Modal visible={aberta} animationType="fade" onRequestClose={fechar}>
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 bg-black" edges={["top", "bottom"]}>
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text className="flex-1 text-lg font-semibold text-white" numberOfLines={1}>
              {titulo}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              onPress={fechar}
              className="p-2"
            >
              <X size={26} color="#fff" />
            </Pressable>
          </View>
          {source ? (
            <Image source={source} style={{ flex: 1 }} resizeMode="contain" />
          ) : (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
