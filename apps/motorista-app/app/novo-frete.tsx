import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, ArrowRight, MapPin, Search } from "lucide-react-native";
import type { EstimativaFrete } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { hojeISO, lancarViagem } from "@/lib/pessoal";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Ponto = { texto: string; lat?: number; lng?: number };

/**
 * "Vale a pena esse frete?" — e, se valer, o registro dele.
 *
 * É a conta que o autônomo faz no papel antes de aceitar uma carga. Aqui ela sai
 * com os números DELE: o consumo e o preço do litro vêm do que ele mesmo lançou
 * no caderno. Ver docs/motorista-sem-empresa.md.
 *
 * A estimativa é um bônus, não um pré-requisito: sem sinal (ou sem achar o
 * endereço no mapa) ele ainda registra o frete digitando o km. Um frete anotado
 * pela metade vale mais que frete nenhum anotado.
 */
export default function NovoFreteScreen() {
  const [origem, setOrigem] = useState<Ponto>({ texto: "" });
  const [destino, setDestino] = useState<Ponto>({ texto: "" });
  const [carga, setCarga] = useState("");
  const [peso, setPeso] = useState("");
  const [pagam, setPagam] = useState("");
  const [kmManual, setKmManual] = useState("");
  const [estimativa, setEstimativa] = useState<EstimativaFrete | null>(null);
  const [estimando, setEstimando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const temCoordenadas = origem.lat != null && destino.lat != null;

  const estimar = useCallback(async () => {
    if (!temCoordenadas) return;
    setEstimando(true);
    setErro(null);
    try {
      setEstimativa(
        await api.estimarFrete({
          origemLat: origem.lat!,
          origemLng: origem.lng!,
          destinoLat: destino.lat!,
          destinoLng: destino.lng!,
        }),
      );
    } catch {
      // Sem rede a estimativa simplesmente não aparece — e o registro continua
      // possível. Não vira erro na cara dele.
      setEstimativa(null);
    } finally {
      setEstimando(false);
    }
  }, [origem, destino, temCoordenadas]);

  useEffect(() => {
    void estimar();
  }, [estimar]);

  const km = estimativa?.km ?? (kmManual ? Number(kmManual.replace(",", ".")) : null);
  const valor = pagam ? Number(pagam.replace(/\./g, "").replace(",", ".")) : null;
  const sobra =
    valor != null && estimativa?.diesel != null ? valor - estimativa.diesel : null;

  async function registrar() {
    setErro(null);
    if (origem.texto.trim().length < 2) return setErro("De onde você sai?");
    if (destino.texto.trim().length < 2) return setErro("Pra onde você leva?");
    setSalvando(true);
    try {
      await lancarViagem({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        data: hojeISO(),
        origem: origem.texto.trim(),
        destino: destino.texto.trim(),
        carga: carga.trim() || undefined,
        km: km ?? undefined,
        peso: peso ? Number(peso.replace(",", ".")) : undefined,
        valorRecebido: valor ?? undefined,
      });
      router.replace("/meus-gastos");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="bg-brand px-6 pb-6 pt-14">
            <View className="flex-row items-center gap-3">
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <ArrowLeft size={24} color="#fff" />
              </Pressable>
              <View className="flex-1">
                <Text className="text-2xl font-extrabold tracking-tight text-white">
                  Vale a pena?
                </Text>
                <Text className="text-sm font-medium text-white/80">
                  Veja o que sobra antes de aceitar o frete
                </Text>
              </View>
            </View>
          </View>

          <View className="flex-1 gap-5 px-6 py-6">
            <BuscaLocal rotulo="Saio de" ponto={origem} onEscolher={setOrigem} />
            <BuscaLocal rotulo="Levo para" ponto={destino} onEscolher={setDestino} />

            {estimando && (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator />
                <Text className="text-base text-muted-foreground">Calculando o caminho…</Text>
              </View>
            )}

            {estimativa?.km != null && (
              <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-medium text-muted-foreground">Distância</Text>
                  <Text className="text-xl font-bold text-foreground">
                    {estimativa.km.toLocaleString("pt-BR")} km
                  </Text>
                </View>

                <View className="flex-row items-start justify-between gap-3">
                  <Text className="text-base font-medium text-muted-foreground">Pedágio</Text>
                  <Text className="flex-1 text-right text-base font-semibold text-foreground">
                    {estimativa.pedagiosDesconhecidos
                      ? "não deu pra conferir"
                      : estimativa.pedagios.length === 0
                        ? "nenhuma praça no caminho"
                        : `${estimativa.pedagios.length} ${
                            estimativa.pedagios.length === 1 ? "praça" : "praças"
                          }: ${estimativa.pedagios.map((p) => p.nome).join(", ")}`}
                  </Text>
                </View>

                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-medium text-muted-foreground">Diesel</Text>
                  <Text className="text-xl font-bold text-foreground">
                    {estimativa.diesel != null ? dinheiro(estimativa.diesel) : "—"}
                  </Text>
                </View>

                {estimativa.diesel != null ? (
                  <Text className="text-xs text-muted-foreground">
                    Pelo SEU consumo: {estimativa.consumoKmPorLitro?.toLocaleString("pt-BR")} km/L
                    a {dinheiro(estimativa.precoLitro!)} o litro, dos últimos 90 dias.
                  </Text>
                ) : (
                  <Text className="text-xs text-muted-foreground">
                    Pra estimar o diesel, lance seus abastecimentos (com litros) e os fretes com
                    km no caderno — a conta sai com os SEUS números, não com média de mercado.
                  </Text>
                )}
              </View>
            )}

            {estimativa?.km == null && temCoordenadas && !estimando && (
              <Text className="text-base text-muted-foreground">
                Não deu pra calcular o caminho agora. Você pode registrar o frete assim mesmo,
                informando o km.
              </Text>
            )}

            {!temCoordenadas && (
              <View className="gap-2">
                <Label>Km (se souber)</Label>
                <Input
                  value={kmManual}
                  onChangeText={(v) => setKmManual(v.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
            )}

            <View className="gap-2">
              <Label>Quanto estão pagando</Label>
              <Input
                value={pagam}
                onChangeText={(v) => setPagam(v.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="0,00"
              />
            </View>

            {sobra != null && (
              <View
                className={`rounded-2xl border-2 p-4 ${
                  sobra > 0 ? "border-green-600 bg-green-50" : "border-destructive bg-destructive/10"
                }`}
              >
                <Text
                  className={`text-base font-medium ${
                    sobra > 0 ? "text-green-900" : "text-destructive"
                  }`}
                >
                  Tirando o diesel, sobram
                </Text>
                <Text
                  className={`text-3xl font-extrabold ${
                    sobra > 0 ? "text-green-700" : "text-destructive"
                  }`}
                >
                  {dinheiro(sobra)}
                </Text>
                <Text
                  className={`mt-1 text-xs ${sobra > 0 ? "text-green-900" : "text-destructive"}`}
                >
                  {estimativa?.pedagios.length
                    ? "Ainda falta descontar o pedágio das praças acima."
                    : "Sem contar pedágio, manutenção e o seu tempo."}
                </Text>
              </View>
            )}

            <View className="gap-2">
              <Label>O que vou carregar (opcional)</Label>
              <Input
                value={carga}
                onChangeText={setCarga}
                placeholder="Areia, brita, mudança…"
              />
            </View>
            <View className="gap-2">
              <Label>Toneladas (opcional)</Label>
              <Input
                value={peso}
                onChangeText={(v) => setPeso(v.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="0"
              />
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            <Button size="lg" className="h-16 bg-green-600" loading={salvando} onPress={registrar}>
              <Text className="text-lg font-bold text-white">
                {salvando ? "Salvando..." : "Peguei esse frete"}
              </Text>
            </Button>
            <Text className="text-center text-xs text-muted-foreground">
              Fica no seu caderno. Nenhuma empresa vê.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Busca de cidade/endereço pelo geocoding.
 *
 * O texto vale por si: se a busca não achar (ou não houver sinal), o que ele
 * digitou é o que fica gravado — só não sai estimativa. Nunca trava o registro
 * esperando o mapa concordar.
 */
function BuscaLocal({
  rotulo,
  ponto,
  onEscolher,
}: {
  rotulo: string;
  ponto: Ponto;
  onEscolher: (p: Ponto) => void;
}) {
  const [sugestoes, setSugestoes] = useState<
    { placeId: string; nome: string; textoCompleto: string }[]
  >([]);
  const [buscando, setBuscando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function digitou(texto: string) {
    // Sem coordenada até ele escolher uma sugestão — digitar de novo invalida a
    // anterior, senão a estimativa seria de um lugar que ele já apagou da tela.
    onEscolher({ texto });
    if (timer.current) clearTimeout(timer.current);
    if (texto.trim().length < 3) return setSugestoes([]);
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        setSugestoes(await api.buscarEndereco(texto.trim()));
      } catch {
        setSugestoes([]);
      } finally {
        setBuscando(false);
      }
    }, 450);
  }

  async function escolher(s: { placeId: string; nome: string; textoCompleto: string }) {
    setSugestoes([]);
    onEscolher({ texto: s.textoCompleto || s.nome });
    try {
      const lugar = await api.resolverEndereco(s.placeId);
      if (lugar?.lat != null && lugar?.lng != null) {
        onEscolher({ texto: s.textoCompleto || s.nome, lat: lugar.lat, lng: lugar.lng });
      }
    } catch {
      /* fica só o texto: dá pra registrar o frete do mesmo jeito */
    }
  }

  return (
    <View className="gap-2">
      <Label>{rotulo}</Label>
      <Input
        value={ponto.texto}
        onChangeText={digitou}
        placeholder="Cidade, obra, pedreira…"
        autoCorrect={false}
      />
      {ponto.lat != null && (
        <View className="flex-row items-center gap-1">
          <MapPin size={14} color="#16a34a" />
          <Text className="text-xs font-medium text-green-700">no mapa</Text>
        </View>
      )}
      {buscando && (
        <View className="flex-row items-center gap-2">
          <Search size={14} color="#64748b" />
          <Text className="text-xs text-muted-foreground">procurando…</Text>
        </View>
      )}
      {sugestoes.map((s) => (
        <Pressable
          key={s.placeId}
          onPress={() => void escolher(s)}
          className="flex-row items-center gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
        >
          <ArrowRight size={16} color="#64748b" />
          <Text className="flex-1 text-base text-foreground">{s.textoCompleto || s.nome}</Text>
        </Pressable>
      ))}
    </View>
  );
}
