import { useEffect, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Check } from "lucide-react-native";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, humanizeApiError } from "@/lib/api";
import { setPendingLocal } from "@/lib/local-novo-bridge";
import {
  useCriarLocal,
  type CriarLocalInput,
  type Local,
  type LocalSugestao,
  type SugestaoEndereco,
} from "@/lib/queries";

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";

const tipoOptions = [
  { value: "AMBOS", label: "Carga e descarga" },
  { value: "CARGA", label: "Apenas carga" },
  { value: "DESCARGA", label: "Apenas descarga" },
];

export default function LocalNovo() {
  const params = useLocalSearchParams<{
    side?: "carga" | "descarga";
    obraId?: string;
  }>();
  const side = params.side === "descarga" ? "descarga" : "carga";
  const tipoSugerido: Tipo =
    params.side === "descarga" ? "DESCARGA" : params.side === "carga" ? "CARGA" : "AMBOS";

  const criar = useCriarLocal();
  const [nome, setNome] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("PR");
  const [cep, setCep] = useState("");
  const [pontoReferencia, setPontoReferencia] = useState("");
  const [tipo, setTipo] = useState<Tipo>(tipoSugerido);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // GPS atual do motorista — passa pro autocomplete pra priorizar
  // endereços próximos.
  const [coordsAtual, setCoordsAtual] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const Location = await import("expo-location");
        const cur = await Location.getForegroundPermissionsAsync();
        if (cur.status !== "granted") return;
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60_000,
          requiredAccuracy: 500,
        });
        if (last && alive) {
          setCoordsAtual({
            lat: last.coords.latitude,
            lng: last.coords.longitude,
          });
        }
      } catch {
        /* sem GPS — autocomplete usa bias regional fallback */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function aplicarSugestao(s: SugestaoEndereco) {
    if (!nome && s.nome) setNome(s.nome);
    setLogradouro(s.logradouro ?? s.nome ?? "");
    setNumero(s.numero ?? "");
    setBairro(s.bairro ?? "");
    setCidade(s.cidade);
    setUf(s.uf);
    setCep(s.cep ?? "");
    setLat(s.lat ?? null);
    setLng(s.lng ?? null);
  }

  async function salvar() {
    setErro(null);

    const nomeT = nome.trim();
    const logT = logradouro.trim();
    const cidT = cidade.trim();
    const ufT = uf.trim().toUpperCase();
    const cepDigits = cep ? cep.replace(/\D/g, "") : "";

    // Validacao client-side com mensagens claras
    if (nomeT.length < 2) {
      setErro("Nome do local: digite pelo menos 2 letras.");
      return;
    }
    if (logT.length < 2) {
      setErro("Endereço: busque ou digite o endereço.");
      return;
    }
    if (cidT.length < 2) {
      setErro("Cidade: digite o nome da cidade.");
      return;
    }
    if (ufT.length !== 2) {
      setErro("Estado: precisa ter 2 letras (ex: PR, SP, SC).");
      return;
    }
    if (cep && cepDigits.length !== 8) {
      setErro("CEP: precisa ter 8 dígitos. Apague se não souber.");
      return;
    }

    const payload: CriarLocalInput = {
      nome: nomeT,
      logradouro: logT,
      numero: numero.trim() || undefined,
      bairro: bairro.trim() || undefined,
      cidade: cidT,
      uf: ufT,
      cep: cepDigits.length === 8 ? cepDigits : undefined,
      pontoReferencia: pontoReferencia.trim() || undefined,
      tipo,
      obraId: params.obraId && params.obraId.length > 0 ? params.obraId : undefined,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
    };

    try {
      await criarELevar(payload);
    } catch (err) {
      // 409 → backend achou locais próximos. Pergunta antes de criar duplicado.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body &&
        typeof err.body === "object" &&
        Array.isArray((err.body as { sugestoes?: LocalSugestao[] }).sugestoes)
      ) {
        const sugestoes = (err.body as { sugestoes: LocalSugestao[] }).sugestoes;
        mostrarSugestoes(sugestoes, payload);
        return;
      }
      setErro(humanizeApiError(err));
    }
  }

  async function criarELevar(payload: CriarLocalInput) {
    const novo = await criar.mutateAsync(payload);
    setPendingLocal({ side, local: novo });
    // Geofence ganha um alvo novo — registra agora pra capturar dwell mesmo
    // que motorista não inicie tracking. Best-effort, não bloqueia o fluxo.
    try {
      const geofence = await import("@/lib/geofence-locais");
      void geofence.sincronizarGeofences();
    } catch {
      /* ok em dev */
    }
    router.back();
  }

  function mostrarSugestoes(sugestoes: LocalSugestao[], payload: CriarLocalInput) {
    // Mostra até 3 sugestões. Cada uma vira um botão "É este!".
    const top = sugestoes.slice(0, 3);
    const botoes = top.map((s) => ({
      text: `É ${s.nome || s.logradouro}`,
      onPress: () => usarSugestao(s),
    }));
    botoes.push({
      text: "Criar novo mesmo assim",
      onPress: () => {
        void criarELevar({ ...payload, forcarCriacao: true }).catch((err) =>
          setErro(humanizeApiError(err)),
        );
      },
    });
    botoes.push({ text: "Cancelar", onPress: () => {} });

    Alert.alert(
      "Já tem locais próximos",
      `Encontrei ${sugestoes.length} local${sugestoes.length === 1 ? "" : "is"} cadastrado${
        sugestoes.length === 1 ? "" : "s"
      } perto daqui. É algum desses?`,
      botoes,
    );
  }

  function usarSugestao(s: LocalSugestao) {
    const local: Local = {
      id: s.id,
      nome: s.nome,
      logradouro: s.logradouro,
      numero: s.numero,
      bairro: s.bairro,
      cidade: s.cidade,
      uf: s.uf,
      pontoReferencia: null,
      tipo: s.tipo,
      obraId: null,
      lat: s.lat,
      lng: s.lng,
    };
    setPendingLocal({ side, local });
    router.back();
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader title="Cadastrar local" />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2">
            <Label>Nome do local *</Label>
            <Input
              value={nome}
              onChangeText={setNome}
              placeholder='ex: Pedreira Souza Naves — balança 2'
              autoCapitalize="words"
            />
            <Text className="text-xs text-muted-foreground">
              Nome específico ajuda na conferência depois.
            </Text>
          </View>

          <View className="gap-2">
            <Label>Buscar endereço</Label>
            <AddressAutocomplete
              value={logradouro}
              onChange={setLogradouro}
              onSelect={aplicarSugestao}
              coords={coordsAtual}
            />
          </View>

          <View className="flex-row gap-2">
            <View className="w-24 gap-2">
              <Label>Número</Label>
              <Input
                value={numero}
                onChangeText={setNumero}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View className="flex-1 gap-2">
              <Label>Bairro</Label>
              <Input value={bairro} onChangeText={setBairro} />
            </View>
          </View>

          <View className="flex-row gap-2">
            <View className="flex-1 gap-2">
              <Label>Cidade *</Label>
              <Input value={cidade} onChangeText={setCidade} />
            </View>
            <View className="w-20 gap-2">
              <Label>UF *</Label>
              <Input
                value={uf}
                onChangeText={(v) => setUf(v.toUpperCase())}
                maxLength={2}
                autoCapitalize="characters"
              />
            </View>
          </View>

          <View className="gap-2">
            <Label>Ponto de referência</Label>
            <Input
              value={pontoReferencia}
              onChangeText={setPontoReferencia}
              placeholder='ex: portaria fundos'
            />
          </View>

          <View className="gap-2">
            <Label>Tipo</Label>
            <Select
              value={tipo}
              onChange={(v) => setTipo(v as Tipo)}
              options={tipoOptions}
            />
          </View>

          {erro && <Text className="text-sm text-destructive">{erro}</Text>}

          <Button size="lg" className="h-20" onPress={salvar} loading={criar.isPending}>
            <Check size={24} color="white" />
            <Text className="text-xl font-bold text-primary-foreground">
              {criar.isPending ? "Salvando..." : "Salvar local"}
            </Text>
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
