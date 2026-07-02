import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { CheckCircle2, MapPin, Plus, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { showConfirm } from "@/lib/alert";
import { haversineMetros, pegarCoordsPrecisa, RAIO_ALERTA_CARGA_M } from "@/lib/geo";
import {
  buscarDescargaDuasEtapas,
  buscarDescargaDuasEtapasOffline,
  buscarLocaisProximos,
  buscarLocaisProximosOffline,
  useBuscaGpsConfig,
  useCriarLocalRapido,
  BUSCA_GPS_CONFIG_DEFAULTS,
  DESCARGA_RAIO_AMPLIADO_PADRAO,
  type Catalogos,
  type LocalProximo,
} from "@/lib/queries";

// `fetch` nativo do RN dispara TypeError("Network request failed") quando
// o device está offline. Detecta esse caso pra cair no fallback local.
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

// Coordenadas com precisão, carregadas pelos estados pra repassar na captura.
// buscaOffline: a busca de locais desse clique caiu no catálogo em cache.
type CoordsCap = { lat: number; lng: number; precisao: number | null; buscaOffline: boolean };

type Estado =
  | { tipo: "vazio" }
  | { tipo: "capturando"; precisao: number | null }
  // buscando outros locais por perto (depois do "Não é esse?").
  | { tipo: "buscando" }
  | {
      tipo: "selecionado";
      local: { id: string; nome: string };
      distanciaMetros?: number;
      vezesUsado?: number;
      // coords do GPS que gerou essa seleção — reusadas no "Não é esse? Ver outros".
      coords?: CoordsCap;
    }
  | {
      tipo: "escolha";
      matches: LocalProximo[];
      coords: CoordsCap;
      /** true = resultados vêm do raio ampliado (sugestão); nunca auto-selecionados. */
      ampliado: boolean;
      raioInicialM: number;
    }
  | { tipo: "sem_match"; coords: CoordsCap };

/** Snapshot do GPS no momento que o motorista marcou a descarga, pra auditoria. */
export type DescargaCaptura = {
  lat: number;
  lng: number;
  precisao: number | null;
  distanciaMetros: number | null;
  /** A busca de locais desse clique foi feita offline (catálogo em cache). */
  buscaOffline: boolean;
};

export function DescargaPorGps({
  clienteId,
  value,
  onChange,
  onCaptura,
  nomeSelecionadoFallback,
  localCargaCoords,
  autoIniciar,
}: {
  clienteId: string | null;
  value: string;
  onChange: (id: string) => void;
  /** Snapshot do GPS no clique (onde estava, precisão, distância até o local
   * escolhido). null quando a seleção não veio de uma captura fresca. */
  onCaptura?: (c: DescargaCaptura | null) => void;
  nomeSelecionadoFallback?: string;
  /** Coordenadas do local de carga já selecionado no form (se houver) — usadas
   * pra alertar quando o motorista está perto do carregamento ao tentar
   * lançar a descarga. */
  localCargaCoords?: { lat: number; lng: number; nome: string } | null;
  /** Quando true, dispara a captura do GPS já no mount (sem esperar o botão).
   * Usado quando o "Finalizar viagem" abre este componente num modal. */
  autoIniciar?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>(() =>
    value && nomeSelecionadoFallback
      ? { tipo: "selecionado", local: { id: value, nome: nomeSelecionadoFallback } }
      : autoIniciar
        ? { tipo: "capturando", precisao: null }
        : { tipo: "vazio" },
  );
  const [erro, setErro] = useState<string | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");
  const criar = useCriarLocalRapido();
  const gpsConfig = useBuscaGpsConfig();
  const qc = useQueryClient();
  const autoDisparado = useRef(false);

  // Auto-dispara a captura no mount quando pedido (modal aberto pelo Finalizar).
  useEffect(() => {
    if (autoIniciar && !value && !autoDisparado.current) {
      autoDisparado.current = true;
      void capturarEBuscar();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function capturarEBuscar() {
    setErro(null);
    setEstado({ tipo: "capturando", precisao: null });
    const cfg = gpsConfig.data ?? BUSCA_GPS_CONFIG_DEFAULTS;
    const coords = await pegarCoordsPrecisa({
      alvoMetros: cfg.gpsAlvoMetros,
      maxMs: cfg.gpsMaxSegundos * 1000,
      onAmostra: (precisao) => setEstado({ tipo: "capturando", precisao }),
    });
    if (!coords) {
      setEstado({ tipo: "vazio" });
      setErro("Não consegui pegar o GPS. Verifique a permissão e tente de novo.");
      return;
    }

    // Sinal fraco: avisa que a posição pode não bater com o local certo e
    // deixa tentar de novo antes de seguir com a busca.
    if (coords.precisao != null && coords.precisao > cfg.gpsLimiteSinalFracoM) {
      const continua = await showConfirm({
        title: "Sinal fraco aqui",
        message: `A posição saiu com precisão de ±${Math.round(coords.precisao)}m, então pode não bater com o local certo. Quer tentar de novo ou continuar assim?`,
        variant: "warning",
        confirmLabel: "Continuar assim",
        cancelLabel: "Tentar de novo",
      });
      if (!continua) {
        void capturarEBuscar();
        return;
      }
    }

    // Se motorista escolheu local de carga e o GPS atual está dentro do raio
    // dele, alerta antes de prosseguir — provável engano (lançou no carregamento).
    if (localCargaCoords) {
      const distCarga = haversineMetros(
        coords.lat,
        coords.lng,
        localCargaCoords.lat,
        localCargaCoords.lng,
      );
      if (distCarga <= RAIO_ALERTA_CARGA_M) {
        const continua = await showConfirm({
          title: "Você está perto do local de carga",
          message: `Está a ${Math.round(distCarga)}m de "${localCargaCoords.nome}". A viagem deve ser lançada na descarga, não no carregamento. Tem certeza?`,
          variant: "warning",
          confirmLabel: "Continuar mesmo assim",
          cancelLabel: "Cancelar",
        });
        if (!continua) {
          setEstado({ tipo: "vazio" });
          return;
        }
      }
    }

    let matches: LocalProximo[];
    let usouRaioAmpliado: boolean;
    let raioInicialM: number;
    let buscaOffline = false;
    try {
      const res = await buscarDescargaDuasEtapas({
        lat: coords.lat,
        lng: coords.lng,
        limit: 5,
      });
      matches = res.locais;
      usouRaioAmpliado = res.usouRaioAmpliado;
      raioInicialM = res.raioInicialM;
    } catch (err) {
      if (!isNetworkError(err)) {
        setErro((err as Error).message || "Erro ao buscar locais próximos");
        setEstado({ tipo: "vazio" });
        return;
      }
      buscaOffline = true;
      // Offline: busca no catálogo cacheado (2 etapas com raios padrão).
      const catalogos = qc.getQueryData<Catalogos>(["catalogos"]);
      if (!catalogos) {
        setErro(
          "Sem internet e sem catálogo carregado. Abra o app com sinal pelo menos uma vez antes.",
        );
        setEstado({ tipo: "vazio" });
        return;
      }
      const res = buscarDescargaDuasEtapasOffline({
        lat: coords.lat,
        lng: coords.lng,
        locais: catalogos.locais,
        limit: 5,
      });
      matches = res.locais;
      usouRaioAmpliado = res.usouRaioAmpliado;
      raioInicialM = res.raioInicialM;
      // Se nada veio do cache (lugar novo), cai no fluxo padrão de
      // sem_match abaixo — motorista digita o nome e o local entra no
      // outbox offline (pendingLocais). Não bloqueia mais.
    }

    const cap: CoordsCap = { lat: coords.lat, lng: coords.lng, precisao: coords.precisao, buscaOffline };
    if (matches.length === 0) {
      setEstado({ tipo: "sem_match", coords: cap });
      setNomeNovo("");
    } else if (matches.length === 1 && !usouRaioAmpliado) {
      // 1 match dentro do raio apertado: motorista está em cima do local.
      const m = matches[0]!;
      onChange(m.id);
      onCaptura?.({ ...cap, distanciaMetros: m.distanciaMetros });
      setEstado({
        tipo: "selecionado",
        local: { id: m.id, nome: m.nome },
        distanciaMetros: m.distanciaMetros,
        vezesUsado: m.vezesUsadoMotorista,
        coords: cap,
      });
    } else {
      // N matches, OU veio do raio ampliado (mesmo 1 só): sempre pede
      // confirmação — nunca auto-seleciona algo que está longe.
      setEstado({ tipo: "escolha", matches, coords: cap, ampliado: usouRaioAmpliado, raioInicialM });
    }
  }

  function escolherMatch(m: LocalProximo) {
    const cap = estado.tipo === "escolha" ? estado.coords : undefined;
    if (cap) onCaptura?.({ ...cap, distanciaMetros: m.distanciaMetros });
    onChange(m.id);
    setEstado({
      tipo: "selecionado",
      local: { id: m.id, nome: m.nome },
      distanciaMetros: m.distanciaMetros,
      vezesUsado: m.vezesUsadoMotorista,
      coords: cap,
    });
  }

  // "Não é esse?" — busca outros locais de descarga num raio ampliado (a partir
  // da posição já capturada) pra o motorista escolher o certo ou cadastrar novo.
  async function verOutros() {
    if (estado.tipo !== "selecionado" || !estado.coords) return;
    const cap = estado.coords;
    setEstado({ tipo: "buscando" });
    let outros: LocalProximo[] = [];
    try {
      outros = await buscarLocaisProximos({
        lat: cap.lat,
        lng: cap.lng,
        tipoUso: "descarga",
        raioM: DESCARGA_RAIO_AMPLIADO_PADRAO,
        limit: 8,
      });
    } catch (err) {
      if (isNetworkError(err)) {
        const catalogos = qc.getQueryData<Catalogos>(["catalogos"]);
        outros = catalogos
          ? buscarLocaisProximosOffline({
              lat: cap.lat,
              lng: cap.lng,
              locais: catalogos.locais,
              tipoUso: "descarga",
              raioM: DESCARGA_RAIO_AMPLIADO_PADRAO,
              limit: 8,
            })
          : [];
      }
    }
    if (outros.length > 0) {
      setEstado({ tipo: "escolha", matches: outros, coords: cap, ampliado: true, raioInicialM: 0 });
    } else {
      setEstado({ tipo: "sem_match", coords: cap });
      setNomeNovo("");
    }
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
      // Offline-first: gera id local, adiciona no catalogo e enfileira no
      // outbox. Funciona sem internet — sync envia depois com idempotência.
      const novo = await criar.mutateAsync({
        nome,
        lat: estado.coords.lat,
        lng: estado.coords.lng,
        precisao: estado.coords.precisao ?? undefined,
        tipo: "DESCARGA",
        clienteIds: clienteId ? [clienteId] : undefined,
      });
      onChange(novo.id);
      // Local criado em cima da posição capturada → distância 0.
      onCaptura?.({ ...estado.coords, distanciaMetros: 0 });
      setEstado({
        tipo: "selecionado",
        local: { id: novo.id, nome: novo.nome },
      });
    } catch (err) {
      // Praticamente impossível agora — enqueueLocal só falha se AsyncStorage quebrar.
      setErro((err as Error).message || "Erro ao criar o local");
    }
  }

  function trocar() {
    onChange("");
    onCaptura?.(null);
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
            Buscando posição precisa…{" "}
            {estado.precisao != null ? `±${Math.round(estado.precisao)} m` : "—"}
          </Text>
        </View>
      )}

      {estado.tipo === "buscando" && (
        <View className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-muted/30 p-4">
          <ActivityIndicator size="small" color="#64748b" />
          <Text className="text-base font-medium text-muted-foreground">
            Procurando outros locais por perto…
          </Text>
        </View>
      )}

      {estado.tipo === "selecionado" && (
        <View className="gap-2">
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
          {estado.coords ? (
            <Button variant="outline" onPress={verOutros}>
              <MapPin size={18} color="#0f172a" />
              <Text className="text-sm font-semibold text-foreground">
                Não é esse lugar? Ver outros
              </Text>
            </Button>
          ) : null}
        </View>
      )}

      {estado.tipo === "escolha" && (
        <View
          className={`gap-2 rounded-2xl border-2 bg-card p-3 ${estado.ampliado ? "border-warning/50" : "border-border"}`}
        >
          {estado.ampliado && estado.raioInicialM > 0 ? (
            <Text className="text-sm font-medium text-foreground">
              Não achei nada a {estado.raioInicialM}m de você. Um pouco mais longe tem{" "}
              {estado.matches.length === 1 ? "este" : `estes ${estado.matches.length}`} — é
              algum deles?
            </Text>
          ) : estado.ampliado ? (
            <Text className="text-sm font-medium text-foreground">
              Locais de descarga por perto — qual é o certo?
            </Text>
          ) : (
            <Text className="text-sm font-medium text-foreground">
              Achei {estado.matches.length} perto. Qual é?
            </Text>
          )}
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
          <Button variant="outline" onPress={abrirSemMatch} className="mt-1">
            <Plus size={18} color="#0f172a" />
            <Text className="text-sm font-semibold text-foreground">
              Não é nenhum — cadastrar novo lugar
            </Text>
          </Button>
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
