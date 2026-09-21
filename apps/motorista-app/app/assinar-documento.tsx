import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenHeader } from "@/components/screen-header";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/api-url";
import { motoristaAtivoId, tokensDe } from "@/lib/sessoes";
import { useMe } from "@/lib/queries";
import { formatCpf } from "@ronan/shared-types";

/**
 * Ler e assinar um papel que o escritório mandou.
 *
 * ⚠️ A INVERSÃO QUE FAZ ISTO VALER ALGUMA COISA: no link público a mesma pessoa
 * manda o arquivo e depois assina. Aqui não — contrato de experiência e ordem
 * de serviço saem do escritório, não do bolso do motorista. Ele nunca vê
 * "mande seu contrato": o documento já está lá, e o que falta é ele LER.
 *
 * E ler é condição, não enfeite. Hoje, pelo link, a pessoa assina um papel que
 * nunca viu — é a maior fragilidade da assinatura simples, e a primeira coisa
 * que cai numa audiência. Então o botão de assinar só acende depois que ele
 * chega no fim do documento. Não é timer: timer é teatro. Chegar no fim é um
 * fato, e o servidor carimba que ele abriu o arquivo.
 *
 * O que NÃO tem aqui, e é de propósito:
 * - **Nada de checkbox "li e concordo".** Uma caixinha de 24px é a definição de
 *   teatro de consentimento. O botão É a declaração, e ele diz o verbo.
 * - **O nome não é digitado.** No link ele é a única prova de que alguém
 *   declarou ser quem é; aqui a sessão já provou, e 25 letras num teclado de
 *   celular dentro de um caminhão é a parede que faz desistir. O CPF continua
 *   sendo digitado: são 11 números que ele sabe de cor, e é o que sobra do ato
 *   de dizer "sou eu".
 * - **Recusar existe e é visível.** Se a única saída da tela é assinar, não é
 *   consentimento, é formulário.
 */
export default function AssinarDocumentoScreen() {
  const router = useRouter();
  const { id, titulo, mimetype } = useLocalSearchParams<{
    id: string;
    titulo?: string;
    mimetype?: string;
  }>();
  const me = useMe();
  const qc = useQueryClient();

  const [token, setToken] = useState<string | null>(null);
  const [chegouNoFim, setChegouNoFim] = useState(false);
  const [cpf, setCpf] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [falhouImagem, setFalhouImagem] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // ⚠️ `<Image>` com header de auth só pode montar com o token PRONTO. Montar
  // antes faz o Fresco (Android) cachear o 401 e a imagem fica preta pra
  // sempre, mesmo depois que o token chega.
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

  const ehImagem = (mimetype ?? "").startsWith("image/");
  const uri = `${API_URL}/m/admissao/documentos/${id}/arquivo`;
  const nome = me.data?.nome ?? "";
  const cpfOk = cpf.replace(/\D/g, "").length === 11;
  const podeAssinar = chegouNoFim && cpfOk && !enviando;

  async function assinar() {
    setEnviando(true);
    setErro(null);
    try {
      await api.assinarDocumentoAdmissao(String(id), nome, cpf.replace(/\D/g, ""));
      await qc.invalidateQueries({ queryKey: ["documentos-obra"] });
      router.back();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui assinar agora.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScreenHeader title={titulo || "Assinar documento"} />

      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          onScroll={({ nativeEvent: n }) => {
            const fim = n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 40;
            if (fim) setChegouNoFim(true);
          }}
          scrollEventThrottle={100}
        >
          <View className="rounded-2xl border-2 border-border bg-card p-4">
            <Text className="text-base text-foreground">
              Leia o papel inteiro. Quando chegar no fim, o botão de assinar libera.
            </Text>
          </View>

          {/* O documento. */}
          {!ehImagem ? (
            <View className="items-center rounded-2xl border-2 border-warning bg-card p-6">
              <Text className="text-center text-lg font-semibold text-foreground">
                Este papel é um arquivo de computador.
              </Text>
              <Text className="mt-2 text-center text-base text-muted-foreground">
                Ainda não dá pra abrir aqui no celular. Fale com o escritório: eles mandam o
                link pra você ler e assinar.
              </Text>
            </View>
          ) : token && !falhouImagem ? (
            <Image
              source={{ uri, headers: { Authorization: `Bearer ${token}` } }}
              style={{ width: "100%", height: 560, backgroundColor: "#000" }}
              resizeMode="contain"
              onError={() => setFalhouImagem(true)}
            />
          ) : falhouImagem ? (
            <View className="items-center rounded-2xl border-2 border-border bg-card p-6">
              <Text className="text-center text-base text-muted-foreground">
                Não deu pra abrir o papel agora. Confira sua internet e volte.
              </Text>
            </View>
          ) : (
            <View className="h-40 items-center justify-center">
              <ActivityIndicator />
            </View>
          )}

          {ehImagem && (
            <>
              <View className="rounded-2xl border-2 border-border bg-card p-4">
                <Text className="text-sm uppercase tracking-wide text-muted-foreground">
                  Você está assinando como
                </Text>
                <Text className="mt-1 text-xl font-bold text-foreground">{nome || "—"}</Text>
              </View>

              <View className="gap-2">
                <Label>Confirme seu CPF</Label>
                <Input
                  value={formatCpf(cpf)}
                  onChangeText={(t) => setCpf(t.replace(/\D/g, "").slice(0, 11))}
                  keyboardType="number-pad"
                  placeholder="000.000.000-00"
                />
              </View>

              {/* A declaração fica FORA de qualquer caixa de marcar: o ato é o
                  toque no botão, e o texto diz o que o toque significa. */}
              <Text className="text-base text-muted-foreground">
                Assinando, você diz que leu este papel e concorda com ele. Ficam gravados seu
                nome, seu CPF, a data e de onde você assinou.
              </Text>

              {erro ? <Text className="text-base text-destructive">{erro}</Text> : null}

              <Button
                variant="success"
                size="lg"
                onPress={() => void assinar()}
                disabled={!podeAssinar}
                loading={enviando}
                accessibilityLabel="Assinar este documento"
              >
                <Check size={22} color="#fff" />
                <Text className="ml-2 text-lg font-bold text-white">Assinar este documento</Text>
              </Button>

              {!chegouNoFim ? (
                <Text className="text-center text-sm text-muted-foreground">
                  Role até o fim do papel para liberar.
                </Text>
              ) : null}
            </>
          )}

          <Button variant="outline" size="lg" onPress={() => router.back()}>
            <X size={20} color="#13316b" />
            <Text className="ml-2 text-base font-semibold text-foreground">
              Não quero assinar agora
            </Text>
          </Button>
          <Text className="text-center text-sm text-muted-foreground">
            Com dúvida, fale com o escritório antes de assinar. Ninguém é obrigado a assinar
            aqui.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
