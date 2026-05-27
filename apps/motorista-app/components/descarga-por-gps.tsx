import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CheckCircle2, MapPin, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { pegarCoords } from "@/lib/geo";
import {
  buscarLocaisProximos,
  useCriarLocalRapido,
  type LocalProximo,
} from "@/lib/queries";

type Estado =
  | { tipo: "vazio" }
  | { tipo: "capturando" }
  | { tipo: "selecionado"; local: { id: string; nome: string }; distanciaMetros?: number; vezesUsado?: number }
  | { tipo: "escolha"; matches: LocalProximo[]; coords: { lat: number; lng: number } }
  | { tipo: "sem_match"; coords: { lat: number; lng: number } };

export function DescargaPorGps({
  clienteId,
  value,
  onChange,
  nomeSelecionadoFallback,
}: {
  clienteId: string | null;
  value: string;
  onChange: (id: string) => void;
  nomeSelecionadoFallback?: string;
}) {
  const [estado, setEstado] = useState<Estado>(() =>
    value && nomeSelecionadoFallback
      ? { tipo: "selecionado", local: { id: value, nome: nomeSelecionadoFallback } }
      : { tipo: "vazio" },
  );
  const [erro, setErro] = useState<string | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");
  const criar = useCriarLocalRapido();

  async function capturarEBuscar() {
    setErro(null);
    setEstado({ tipo: "capturando" });
    const coords = await pegarCoords();
    if (!coords) {
      setEstado({ tipo: "vazio" });
      setErro("Não consegui pegar o GPS. Verifique a permissão e tente de novo.");
      return;
    }
    try {
      const matches = await buscarLocaisProximos({
        lat: coords.lat,
        lng: coords.lng,
        tipoUso: "descarga",
        raioM: 500,
        limit: 5,
      });
      if (matches.length === 0) {
        setEstado({ tipo: "sem_match", coords });
        setNomeNovo("");
      } else if (matches.length === 1) {
        const m = matches[0]!;
        onChange(m.id);
        setEstado({
          tipo: "selecionado",
          local: { id: m.id, nome: m.nome },
          distanciaMetros: m.distanciaMetros,
          vezesUsado: m.vezesUsadoMotorista,
        });
      } else {
        setEstado({ tipo: "escolha", matches, coords });
      }
    } catch (err) {
      setErro((err as Error).message || "Erro ao buscar locais próximos");
      setEstado({ tipo: "vazio" });
    }
  }

  function escolherMatch(m: LocalProximo) {
    onChange(m.id);
    setEstado({
      tipo: "selecionado",
      local: { id: m.id, nome: m.nome },
      distanciaMetros: m.distanciaMetros,
      vezesUsado: m.vezesUsadoMotorista,
    });
  }

  function abrirSemMatch() {
    if (estado.tipo === "escolha") {
      setEstado({ tipo: "sem_match", coords: estado.coords });
      setNomeNovo("");
    }
  }

  async function salvarNomeNovo() {
    if (estado.tipo !== "sem_match") return;
    const nome = nomeNovo.trim();
    if (nome.length < 2) {
      setErro("Digite um nome de pelo menos 2 letras.");
      return;
    }
    setErro(null);
    try {
      const novo = await criar.mutateAsync({
        nome,
        lat: estado.coords.lat,
        lng: estado.coords.lng,
        tipo: "DESCARGA",
        clienteIds: clienteId ? [clienteId] : undefined,
      });
      onChange(novo.id);
      setEstado({
        tipo: "selecionado",
        local: { id: novo.id, nome: novo.nome },
      });
    } catch (err) {
      setErro((err as Error).message || "Erro ao criar o local");
    }
  }

  function trocar() {
    onChange("");
    setEstado({ tipo: "vazio" });
    setErro(null);
  }

  return (
    <View className="gap-2">
      <Label>Local de descarga</Label>

      {estado.tipo === "vazio" && (
        <Button onPress={capturarEBuscar} size="lg" className="h-16">
          <MapPin size={22} color="white" />
          <Text className="text-base font-bold text-primary-foreground">
            Estou no local de descarga
          </Text>
        </Button>
      )}

      {estado.tipo === "capturando" && (
        <View className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-muted/30 p-4">
          <ActivityIndicator size="small" color="#64748b" />
          <Text className="text-base font-medium text-muted-foreground">
            Pegando localização...
          </Text>
        </View>
      )}

      {estado.tipo === "selecionado" && (
        <View className="flex-row items-start gap-3 rounded-2xl border-2 border-success/40 bg-success/15 p-4">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-success">
            <CheckCircle2 size={20} color="white" strokeWidth={2.5} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-bold text-foreground" numberOfLines={2}>
              {estado.local.nome}
            </Text>
            {(estado.distanciaMetros != null || estado.vezesUsado != null) && (
              <Text
                className="mt-0.5 text-sm text-muted-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {estado.distanciaMetros != null && `${estado.distanciaMetros}m do GPS`}
                {estado.distanciaMetros != null && estado.vezesUsado ? " · " : ""}
                {estado.vezesUsado ? `usado ${estado.vezesUsado}x em 90d` : ""}
              </Text>
            )}
          </View>
          <Pressable
            onPress={trocar}
            className="h-9 items-center justify-center rounded-md border border-border bg-background px-3"
          >
            <Text className="text-sm font-medium text-foreground">Trocar</Text>
          </Pressable>
        </View>
      )}

      {estado.tipo === "escolha" && (
        <View className="gap-2 rounded-2xl border-2 border-border bg-card p-3">
          <Text className="text-sm font-medium text-foreground">
            Achei {estado.matches.length} perto. Qual é?
          </Text>
          {estado.matches.map((m, i) => (
            <Pressable
              key={m.id}
              onPress={() => escolherMatch(m)}
              className="flex-row items-center gap-3 rounded-xl border border-border bg-background p-3 active:opacity-70"
            >
              <View className="h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Text className="text-base font-bold text-primary">{i + 1}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                  {m.nome}
                </Text>
                <Text
                  className="text-xs text-muted-foreground"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {m.distanciaMetros}m · {m.cidade}/{m.uf}
                  {m.vezesUsadoMotorista > 0 ? ` · usado ${m.vezesUsadoMotorista}x` : ""}
                </Text>
              </View>
            </Pressable>
          ))}
          <Pressable onPress={abrirSemMatch} className="mt-1 p-2 active:opacity-70">
            <Text className="text-center text-sm font-medium text-primary">
              Nenhum desses — criar novo
            </Text>
          </Pressable>
        </View>
      )}

      {erro && <Text className="text-sm text-destructive">{erro}</Text>}

      {/* Modal full-screen: pedir nome quando sem match.
          Full-screen (não bottom-sheet transparent) pra Android adjustResize
          funcionar e o teclado não sobrepor o input. */}
      <Modal
        visible={estado.tipo === "sem_match"}
        animationType="slide"
        onRequestClose={() => {
          if (estado.tipo === "sem_match") setEstado({ tipo: "vazio" });
        }}
      >
        <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-background">
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            className="flex-1"
          >
            <View className="flex-row items-center justify-between border-b border-border p-4">
              <Text className="text-lg font-bold text-foreground">
                Como chama esse lugar?
              </Text>
              <Pressable
                onPress={() => setEstado({ tipo: "vazio" })}
                className="h-10 w-10 items-center justify-center rounded-full bg-muted"
              >
                <X size={20} color="#0f172a" />
              </Pressable>
            </View>

            <View className="flex-1 gap-4 p-5">
              <Text className="text-sm text-muted-foreground">
                Não conheço esse lugar aqui — me ajuda dando um nome rápido.
              </Text>

              <View className="gap-2">
                <Label>Nome do local</Label>
                <TextInput
                  value={nomeNovo}
                  onChangeText={setNomeNovo}
                  placeholder='ex: "Obra do shopping", "Construtora X"'
                  placeholderTextColor="#94a3b8"
                  autoFocus
                  maxLength={120}
                  returnKeyType="done"
                  onSubmitEditing={salvarNomeNovo}
                  className="rounded-xl border border-border bg-background px-3 py-4 text-base text-foreground"
                />
                <Text className="text-xs text-muted-foreground">
                  Gravamos o GPS aqui. Endereço completo o escritório completa depois.
                </Text>
              </View>

              {erro && <Text className="text-sm text-destructive">{erro}</Text>}
            </View>

            <View className="flex-row gap-3 border-t border-border p-4">
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => setEstado({ tipo: "vazio" })}
              >
                <Text className="text-base font-medium text-foreground">Cancelar</Text>
              </Button>
              <Button
                className="flex-1"
                onPress={salvarNomeNovo}
                loading={criar.isPending}
              >
                <Text className="text-base font-bold text-primary-foreground">
                  Salvar local
                </Text>
              </Button>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
