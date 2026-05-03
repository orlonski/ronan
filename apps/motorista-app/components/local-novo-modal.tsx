import { useState } from "react";
import { X } from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  useCriarLocal,
  type Local,
  type SugestaoEndereco,
} from "@/lib/queries";

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";

const tipoOptions = [
  { value: "AMBOS", label: "Carga e descarga" },
  { value: "CARGA", label: "Apenas carga" },
  { value: "DESCARGA", label: "Apenas descarga" },
];

export function LocalNovoModal({
  open,
  onClose,
  onCreated,
  obraId,
  tipoSugerido = "AMBOS",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (l: Local) => void;
  obraId?: string;
  tipoSugerido?: Tipo;
}) {
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

  function reset() {
    setNome("");
    setLogradouro("");
    setNumero("");
    setBairro("");
    setCidade("");
    setUf("PR");
    setCep("");
    setPontoReferencia("");
    setTipo(tipoSugerido);
    setLat(null);
    setLng(null);
    setErro(null);
  }

  function fechar() {
    reset();
    onClose();
  }

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
    if (!nome.trim() || !logradouro.trim() || !cidade.trim() || !uf.trim()) {
      setErro("Preencha nome, endereço e cidade.");
      return;
    }
    try {
      const novo = await criar.mutateAsync({
        nome: nome.trim(),
        logradouro: logradouro.trim(),
        numero: numero.trim() || undefined,
        bairro: bairro.trim() || undefined,
        cidade: cidade.trim(),
        uf: uf.trim().toUpperCase(),
        cep: cep ? cep.replace(/\D/g, "") : undefined,
        pontoReferencia: pontoReferencia.trim() || undefined,
        tipo,
        obraId,
        lat: lat ?? undefined,
        lng: lng ?? undefined,
      });
      onCreated(novo);
      fechar();
    } catch (err) {
      setErro((err as Error).message ?? "Erro ao salvar local");
    }
  }

  return (
    <Modal
      visible={open}
      animationType="slide"
      transparent
      onRequestClose={fechar}
    >
      <View className="flex-1 bg-black/50">
        <Pressable className="flex-1" onPress={fechar} />
        <SafeAreaView edges={["bottom"]} className="rounded-t-2xl bg-background">
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View className="px-4 py-3">
              <View className="mb-3 h-1 w-12 self-center rounded-full bg-muted" />
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-semibold text-foreground">
                  Cadastrar local novo
                </Text>
                <Pressable
                  onPress={fechar}
                  className="h-8 w-8 items-center justify-center rounded-full"
                >
                  <X size={18} color="#0f172a" />
                </Pressable>
              </View>
            </View>

            <ScrollView
              className="px-4"
              style={{ maxHeight: 520 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16, gap: 12 }}
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
                />
              </View>

              <View className="flex-row gap-2">
                <View className="w-24 gap-2">
                  <Label>Número</Label>
                  <Input value={numero} onChangeText={setNumero} keyboardType="numbers-and-punctuation" />
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

              <View className="mt-2 flex-row gap-2">
                <Button variant="outline" className="flex-1" onPress={fechar}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onPress={salvar}
                  loading={criar.isPending}
                >
                  {criar.isPending ? "Salvando..." : "Salvar local"}
                </Button>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
