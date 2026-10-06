import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { Camera, CloudUpload, FileText, Image as ImageIcon, Paperclip, X } from "lucide-react-native";
import { PhotoCapture } from "@/components/photo-capture";
import { VerDePerto } from "@/components/miniatura-documento";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api-url";
import { motoristaAtivoId, tokensDe } from "@/lib/sessoes";
import { escolherArquivo, podeEscolherArquivo } from "@/lib/escolher-arquivo";
import { caminhoArquivoEtapa } from "@/lib/etapas";
import { guardarArquivo, type ArquivoRascunho } from "@/lib/etapas-local";

/**
 * O build atual tem o seletor de arquivos (módulo nativo)? Sem ele o botão de
 * PDF simplesmente não existe — e a foto da tela continua valendo.
 */
export function usePodeEscolherArquivo(): boolean {
  const [pode, setPode] = useState(false);
  useEffect(() => {
    let vivo = true;
    void podeEscolherArquivo().then((p) => {
      if (vivo) setPode(p);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return pode;
}

/** Token pronto pra `<Image>` autenticada (montar antes cacheia o 401 no Android). */
function useToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
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
  return token;
}

/**
 * Miniatura de um arquivo do formulário. Local primeiro (instantânea, sem
 * dado); do servidor só com o token pronto. Toca e abre grande NA PRÓPRIA
 * TELA. O selo de nuvem = "guardado aqui, sobe quando pegar sinal".
 */
function Miniatura({
  arquivo,
  titulo,
  naFila,
  token,
}: {
  arquivo: ArquivoRascunho;
  titulo: string;
  naFila: boolean;
  token: string | null;
}) {
  const [aberta, setAberta] = useState(false);
  const ehImagem = arquivo.mime.startsWith("image/");
  const remota = arquivo.arquivoId && token
    ? {
        uri: `${API_URL}${caminhoArquivoEtapa(arquivo.arquivoId)}`,
        headers: { Authorization: `Bearer ${token}` },
      }
    : null;
  const source = arquivo.uri ? { uri: arquivo.uri } : remota;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ver ${titulo} de perto`}
        onPress={() => ehImagem && setAberta(true)}
        className={`h-20 w-16 items-center justify-center overflow-hidden rounded-lg border-2 bg-muted ${
          naFila ? "border-warning" : "border-border"
        }`}
      >
        {!ehImagem ? (
          <>
            <FileText size={22} color="#6b7280" />
            <Text className="mt-0.5 text-[10px] font-semibold text-muted-foreground">PDF</Text>
          </>
        ) : source ? (
          <Image source={source} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <ActivityIndicator size="small" />
        )}
        {naFila ? (
          <View className="absolute inset-0 items-center justify-center bg-black/30">
            <CloudUpload size={18} color="#fff" />
          </View>
        ) : null}
      </Pressable>
      {ehImagem ? (
        <VerDePerto titulo={titulo} aberta={aberta} fechar={() => setAberta(false)} source={source} />
      ) : null}
    </>
  );
}

/**
 * Fotos (e PDF, quando o item aceita e o build tem o seletor) de UM item.
 *
 * - Botões com ícone e verbo; depois da 1ª foto, "Tirar foto" vira "Mais uma foto".
 * - Apagar é confirmado NA PRÓPRIA miniatura (nunca `showConfirm` — fica atrás
 *   de qualquer Modal): "Apagar esta foto?" [Manter] [Apagar].
 */
export function ArquivosItem({
  titulo,
  arquivos,
  max,
  aceitaPdf,
  idsNaFila,
  desabilitado,
  onAdicionar,
  onRemover,
  onAviso,
}: {
  titulo: string;
  arquivos: ArquivoRascunho[];
  max: number;
  aceitaPdf: boolean;
  /** Ids dos arquivos que ainda não subiram. */
  idsNaFila: Set<string>;
  desabilitado?: boolean;
  onAdicionar: (a: ArquivoRascunho) => void;
  onRemover: (id: string) => void;
  /** Recado curto pro motorista (arquivo grande demais etc.). */
  onAviso: (msg: string | null) => void;
}) {
  const token = useToken();
  const temSeletor = usePodeEscolherArquivo();
  const [apagando, setApagando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cheio = arquivos.length >= max;

  async function adicionar(a: { uri: string; mime: string; nome?: string; tamanho?: number }) {
    setGuardando(true);
    try {
      const r = await guardarArquivo(a);
      if (r.ok) {
        onAviso(null);
        onAdicionar(r.arquivo);
      } else {
        onAviso(r.motivo);
      }
    } finally {
      setGuardando(false);
    }
  }

  async function escolherPdf() {
    const a = await escolherArquivo();
    if (!a) return; // desistir não é erro
    await adicionar({ uri: a.uri, mime: a.mime, nome: a.nome, tamanho: a.tamanho });
  }

  return (
    <View className="gap-3">
      {arquivos.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {arquivos.map((a) =>
            apagando === a.id ? (
              <View key={a.id} className="w-full gap-2 rounded-xl border-2 border-destructive/40 bg-card p-3">
                <Text className="text-base font-bold text-foreground">
                  {a.mime.startsWith("image/") ? "Apagar esta foto?" : "Apagar este arquivo?"}
                </Text>
                <View className="flex-row gap-2">
                  <Button variant="outline" className="flex-1" onPress={() => setApagando(null)}>
                    <Text className="text-base font-semibold text-foreground">Manter</Text>
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onPress={() => {
                      setApagando(null);
                      onRemover(a.id);
                    }}
                  >
                    <X size={18} color="white" />
                    <Text className="text-base font-semibold text-destructive-foreground">Apagar</Text>
                  </Button>
                </View>
              </View>
            ) : (
              <View key={a.id} className="relative">
                <Miniatura arquivo={a} titulo={titulo} naFila={idsNaFila.has(a.id)} token={token} />
                {!desabilitado ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Apagar"
                    onPress={() => setApagando(a.id)}
                    hitSlop={10}
                    className="absolute -right-2 -top-2 h-7 w-7 items-center justify-center rounded-full bg-foreground"
                  >
                    <X size={16} color="white" />
                  </Pressable>
                ) : null}
              </View>
            ),
          )}
        </View>
      ) : null}

      {!desabilitado && !cheio ? (
        <PhotoCapture
          value={null}
          onChange={(p) => {
            if (p) void adicionar({ uri: p.uri, mime: p.mime });
          }}
          renderVazio={({ abrirCamera, abrirGaleria, escolhendo }) => (
            <View className="gap-2">
              <View className="flex-row gap-2">
                <Button className="flex-1" onPress={() => void abrirCamera()} loading={guardando}>
                  <Camera size={20} color="white" />
                  <Text className="text-base font-semibold text-primary-foreground">
                    {arquivos.length > 0 ? "Mais uma foto" : "Tirar foto"}
                  </Text>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={abrirGaleria}
                  loading={escolhendo}
                >
                  <ImageIcon size={20} color="#0f172a" />
                  <Text className="text-base font-semibold text-foreground">Galeria</Text>
                </Button>
              </View>
              {aceitaPdf && temSeletor ? (
                <Button variant="outline" onPress={() => void escolherPdf()}>
                  <Paperclip size={20} color="#0f172a" />
                  <Text className="text-base font-semibold text-foreground">Escolher arquivo (PDF)</Text>
                </Button>
              ) : null}
            </View>
          )}
        />
      ) : null}
    </View>
  );
}
