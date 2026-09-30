import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Check, MapPin, MapPinPlus, Search, WifiOff, X } from "lucide-react-native";
import { formatarNomeLocal } from "@ronan/shared-types";
import { api } from "@/lib/api";
import {
  buscarLocaisProximosOffline,
  useCatalogos,
  useCriarLocalRapido,
  type Local,
  type LocalProximo,
  type SugestaoEndereco,
  type SugestaoLista,
} from "@/lib/queries";
import { formatarDistancia } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { enderecoResumido, FotoLocal, LinhaEndereco } from "@/components/local-info";
import type { TelemetriaViagem } from "@/lib/telemetria-viagem";

/**
 * Busca de local por NOME sobre o catálogo cacheado (offline, instantâneo) e,
 * quando a empresa liga `app.locais.buscarEndereco`, busca de ENDEREÇO NOVO no
 * mapa — a mesma do "Novo local" do painel — no mesmo campo.
 *
 * Um campo só, de propósito: o motorista digita o que sabe ("Pedreira Bosch",
 * "Rua XV, Curitiba") e vê primeiro o que já está cadastrado; o endereço novo
 * vem embaixo. Assim ele não cria duplicata de um local que já existia só
 * porque abriu a busca errada.
 *
 * O endereço escolhido vira local em RASCUNHO pelo mesmo outbox do cadastro por
 * GPS (`useCriarLocalRapido`) e cai em "Em validação" no painel. A busca no
 * mapa precisa de sinal; os cadastrados continuam funcionando sem.
 */

// Deburr manual pros acentos comuns do PT — evita depender de String.normalize
// (suporte irregular no Hermes) e cobre o alfabeto que aparece em nomes de local.
function semAcento(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áàâãä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôõö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/ç/g, "c")
    .replace(/ñ/g, "n");
}

// Raio (m) do aviso "já tem um cadastrado perto desse endereço". Mesmo valor
// do aviso anti-duplicata do cadastro por GPS.
const RAIO_AVISO_DUPLICATA_M = 150;
const MIN_LETRAS_ENDERECO = 3;
const MAX_CADASTRADOS_COM_ENDERECO = 8;

type EstadoEndereco =
  | { tipo: "parado" }
  | { tipo: "buscando" }
  | { tipo: "ok"; sugestoes: SugestaoLista[] }
  | { tipo: "semSinal" };

type Escolhido = { detalhe: SugestaoEndereco & { lat: number; lng: number }; texto: string };

export function BuscarLocalModal({
  visible,
  onClose,
  onSelecionar,
  telemetria,
  lado = "descarga",
  clienteId,
  mostrarCadastrados = true,
  permiteEndereco = false,
  coords,
  textoInicial,
}: {
  visible: boolean;
  onClose: () => void;
  /** Local cadastrado escolhido OU o local novo criado a partir do endereço. */
  onSelecionar: (local: Local) => void;
  /** Telemetria opt-in: registra o texto buscado + nº de resultados. */
  telemetria?: TelemetriaViagem;
  lado?: "carga" | "descarga";
  /** Carga: só os locais desse cliente (+ genéricos), e o local novo nasce dele. */
  clienteId?: string | null;
  /** Lista os locais já cadastrados (a "busca pelo nome"). */
  mostrarCadastrados?: boolean;
  /** Capacidade `app.locais.buscarEndereco` ligada pra ele. */
  permiteEndereco?: boolean;
  /** Posição dele: puxa os endereços mais perto pro topo da busca. */
  coords?: { lat: number; lng: number } | null;
  /** O que ele já tinha digitado na lista anterior (não perder o que digitou). */
  textoInicial?: string;
}) {
  const [q, setQ] = useState("");
  const [end, setEnd] = useState<EstadoEndereco>({ tipo: "parado" });
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<Escolhido | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const catalogos = useCatalogos();
  const criar = useCriarLocalRapido();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Resposta velha não pode sobrescrever a nova (digitou rápido, rede lenta).
  const seqRef = useRef(0);

  useEffect(() => {
    if (visible) setQ(textoInicial ?? "");
    // Só ao abrir: o textoInicial é o ponto de partida, não um valor controlado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const tiposDoLado: Local["tipo"][] =
    lado === "carga" ? ["CARGA", "AMBOS"] : ["DESCARGA", "AMBOS"];

  const doLado = useMemo(
    () =>
      (catalogos.data?.locais ?? []).filter(
        (l) =>
          tiposDoLado.includes(l.tipo) &&
          (lado !== "carga" ||
            !clienteId ||
            l.clienteIds.length === 0 ||
            l.clienteIds.includes(clienteId)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogos.data, lado, clienteId],
  );

  const locaisTodos = useMemo(() => {
    if (!mostrarCadastrados) return [];
    const termo = semAcento(q.trim());
    if (!termo) return doLado;
    return doLado.filter(
      (l) => semAcento(l.nome).includes(termo) || semAcento(l.cidade ?? "").includes(termo),
    );
  }, [doLado, q, mostrarCadastrados]);
  // Com a busca de endereço ligada, os endereços vêm DEPOIS dos cadastrados:
  // sem um teto, "Curitiba" traria centenas e empurraria o mapa pra fora da tela.
  const locais =
    permiteEndereco && q.trim().length >= MIN_LETRAS_ENDERECO
      ? locaisTodos.slice(0, MAX_CADASTRADOS_COM_ENDERECO)
      : locaisTodos;

  // Busca de endereço no mapa, com o mesmo debounce/mínimo do painel.
  useEffect(() => {
    if (!visible || !permiteEndereco) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const termo = q.trim();
    if (termo.length < MIN_LETRAS_ENDERECO) {
      seqRef.current++;
      setEnd({ tipo: "parado" });
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setEnd({ tipo: "buscando" });
      try {
        const params = new URLSearchParams({ q: termo });
        if (coords) {
          params.set("lat", coords.lat.toString());
          params.set("lng", coords.lng.toString());
        }
        const data = await api.get<SugestaoLista[]>(`/geocoding/buscar?${params.toString()}`);
        if (seq === seqRef.current) setEnd({ tipo: "ok", sugestoes: data ?? [] });
      } catch {
        if (seq === seqRef.current) setEnd({ tipo: "semSinal" });
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, visible, permiteEndereco, coords]);

  function fechar() {
    if (telemetria && q.trim() && mostrarCadastrados) {
      telemetria.busca(`${lado}_nome`, q.trim(), locaisTodos.length, doLado.length);
    }
    seqRef.current++;
    setQ("");
    setEnd({ tipo: "parado" });
    setEscolhido(null);
    setNomeNovo("");
    setErro(null);
    setResolvendo(null);
    onClose();
  }

  async function escolherSugestao(s: SugestaoLista) {
    setErro(null);
    setResolvendo(s.placeId);
    try {
      const detalhe = await api.get<SugestaoEndereco | null>(
        `/geocoding/place?placeId=${encodeURIComponent(s.placeId)}`,
      );
      if (!detalhe || detalhe.lat == null || detalhe.lng == null) {
        setErro("Esse endereço não tem ponto no mapa. Tente outro mais completo (rua e cidade).");
        return;
      }
      setEscolhido({
        detalhe: { ...detalhe, lat: detalhe.lat, lng: detalhe.lng },
        texto: s.textoCompleto || detalhe.textoCompleto || s.nome,
      });
      setNomeNovo(detalhe.nome ?? s.nome ?? detalhe.logradouro ?? "");
    } catch {
      setErro("Não deu pra abrir esse endereço. Confira o sinal e toque de novo.");
    } finally {
      setResolvendo(null);
    }
  }

  // Já cadastrado perto do endereço escolhido: oferece antes de criar outro.
  const perto: LocalProximo | null = useMemo(() => {
    if (!escolhido) return null;
    const lista = buscarLocaisProximosOffline({
      lat: escolhido.detalhe.lat,
      lng: escolhido.detalhe.lng,
      locais: catalogos.data?.locais ?? [],
      tipoUso: lado,
      clienteId: lado === "carga" ? (clienteId ?? undefined) : undefined,
      raioM: RAIO_AVISO_DUPLICATA_M,
      limit: 1,
    });
    return lista[0] ?? null;
  }, [escolhido, catalogos.data, lado, clienteId]);

  function usarCadastrado(id: string) {
    const local = (catalogos.data?.locais ?? []).find((l) => l.id === id);
    if (!local) return;
    onSelecionar(local);
    fechar();
  }

  async function usarEnderecoNovo() {
    if (!escolhido) return;
    const nome = nomeNovo.trim();
    if (nome.length < 2) {
      setErro("Dê um nome pro local, de pelo menos 2 letras.");
      return;
    }
    setErro(null);
    const d = escolhido.detalhe;
    try {
      const local = await criar.mutateAsync({
        nome,
        lat: d.lat,
        lng: d.lng,
        tipo: lado === "carga" ? "CARGA" : "DESCARGA",
        clienteIds: clienteId ? [clienteId] : undefined,
        endereco: {
          logradouro: d.logradouro,
          numero: d.numero,
          bairro: d.bairro,
          cidade: d.cidade,
          uf: d.uf,
          cep: d.cep,
        },
      });
      onSelecionar(local);
      fechar();
    } catch (err) {
      setErro((err as Error).message || "Não deu pra salvar o local. Tente de novo.");
    }
  }

  const titulo = escolhido
    ? "Confirmar endereço"
    : lado === "carga"
      ? "Buscar local de carga"
      : "Buscar local";
  const placeholder = permiteEndereco
    ? mostrarCadastrados
      ? "Nome do local ou endereço"
      : "Rua, bairro, cidade ou nome do lugar"
    : "Digite o nome do local";

  const secaoEndereco = permiteEndereco ? (
    <View className="mt-2">
      <View className="flex-row items-center gap-2 bg-muted/40 px-4 py-2">
        <MapPinPlus size={16} color="#475569" />
        <Text className="flex-1 text-sm font-semibold text-muted-foreground">
          Endereço novo no mapa
        </Text>
        {end.tipo === "buscando" && <ActivityIndicator size="small" />}
      </View>
      {end.tipo === "parado" && (
        <Text className="px-4 py-4 text-sm text-muted-foreground">
          Não achou na lista? Digite pelo menos {MIN_LETRAS_ENDERECO} letras do endereço — rua,
          bairro, cidade ou o nome do lugar.
        </Text>
      )}
      {end.tipo === "semSinal" && (
        <View className="flex-row items-start gap-2 px-4 py-4">
          <WifiOff size={18} color="#b45309" />
          <Text className="flex-1 text-sm text-amber-800">
            A busca no mapa precisa de sinal. Os locais já cadastrados continuam aparecendo acima.
          </Text>
        </View>
      )}
      {end.tipo === "ok" && end.sugestoes.length === 0 && (
        <Text className="px-4 py-4 text-sm text-muted-foreground">
          Nenhum endereço com esse texto. Tente com a cidade junto.
        </Text>
      )}
      {end.tipo === "ok" &&
        end.sugestoes.map((s) => (
          <Pressable
            key={s.placeId}
            onPress={() => void escolherSugestao(s)}
            disabled={resolvendo != null}
            className="flex-row items-start gap-3 border-b border-border px-4 py-4 active:bg-muted"
          >
            <View className="mt-0.5">
              {resolvendo === s.placeId ? (
                <ActivityIndicator size="small" />
              ) : (
                <MapPinPlus size={18} color="#B4501A" />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground" numberOfLines={2}>
                {s.nome}
              </Text>
              <Text className="text-sm text-muted-foreground" numberOfLines={2}>
                {s.textoCompleto}
              </Text>
            </View>
          </Pressable>
        ))}
      {erro && !escolhido && <Text className="px-4 py-3 text-sm text-destructive">{erro}</Text>}
    </View>
  ) : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => (escolhido ? setEscolhido(null) : fechar())}
    >
      {/* SafeAreaProvider dentro do Modal: no iOS o inset do topo não propaga pro
          conteúdo do Modal sem isso, e o header ficava sob a barra de status/notch. */}
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
          <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
            {escolhido && (
              <Pressable
                onPress={() => {
                  setEscolhido(null);
                  setErro(null);
                }}
                className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
              >
                <ArrowLeft size={24} color="#0f172a" />
              </Pressable>
            )}
            <Text className="flex-1 text-lg font-bold text-foreground">{titulo}</Text>
            <Pressable
              onPress={fechar}
              className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
            >
              <X size={24} color="#0f172a" />
            </Pressable>
          </View>

          {escolhido ? (
            // Teclado no Android (edge-to-edge) não redimensiona a janela:
            // padding nas duas plataformas.
            <KeyboardAvoidingView behavior="padding" className="flex-1">
              <ScrollView
                contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}
                keyboardShouldPersistTaps="handled"
              >
                <FotoLocal lat={escolhido.detalhe.lat} lng={escolhido.detalhe.lng} altura={150} />
                <View className="flex-row items-start gap-2">
                  <MapPin size={18} color="#2563eb" />
                  <Text className="flex-1 text-base text-foreground">{escolhido.texto}</Text>
                </View>
                {perto && (
                  <View className="gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                    <Text className="text-base font-bold text-amber-900">
                      Já tem um local cadastrado aqui perto
                    </Text>
                    <Text className="text-sm text-amber-800">
                      {formatarNomeLocal(perto.nome)} fica a{" "}
                      {formatarDistancia(perto.distanciaMetros)} desse endereço.
                      {mostrarCadastrados ? " Se for ele, use o cadastrado." : " Confira se não é o mesmo lugar."}
                    </Text>
                    {mostrarCadastrados && (
                    <Button onPress={() => usarCadastrado(perto.id)}>
                      <Check size={20} color="white" />
                      <Text className="text-base font-bold text-primary-foreground">
                        Usar {formatarNomeLocal(perto.nome)}
                      </Text>
                    </Button>
                    )}
                  </View>
                )}

                <View className="gap-1.5">
                  <Text className="text-sm font-semibold text-foreground">Nome do local</Text>
                  <TextInput
                    value={nomeNovo}
                    onChangeText={setNomeNovo}
                    placeholder={lado === "carga" ? "Ex.: Pedreira X" : "Ex.: Obra do Condomínio Y"}
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={120}
                    className="h-14 rounded-xl border-2 border-border bg-background px-4 text-base text-foreground"
                  />
                  <Text className="text-xs text-muted-foreground">
                    É o nome que aparece na lista. O escritório confere o endereço depois.
                  </Text>
                </View>

                {erro && <Text className="text-sm text-destructive">{erro}</Text>}

                <Button
                  variant={perto ? "warning" : "success"}
                  onPress={() => void usarEnderecoNovo()}
                  loading={criar.isPending}
                  className="h-16"
                >
                  {!criar.isPending && (
                    <Check size={22} color={perto ? "#0f172a" : "white"} />
                  )}
                  <Text
                    className={`text-base font-bold ${perto ? "text-warning-foreground" : "text-success-foreground"}`}
                  >
                    {perto ? "Usar o endereço novo mesmo assim" : "Usar este endereço"}
                  </Text>
                </Button>
                <Button
                  variant="outline"
                  onPress={() => {
                    setEscolhido(null);
                    setErro(null);
                  }}
                >
                  <ArrowLeft size={18} color="#0f172a" />
                  <Text className="text-sm font-semibold text-foreground">Voltar pra busca</Text>
                </Button>
              </ScrollView>
            </KeyboardAvoidingView>
          ) : (
            <KeyboardAvoidingView behavior="padding" className="flex-1">
              <View className="px-4 py-3">
                <View className="relative">
                  <View className="absolute left-3 top-1/2 z-10 -translate-y-1/2">
                    <Search size={20} color="#64748b" />
                  </View>
                  <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder={placeholder}
                    placeholderTextColor="#94a3b8"
                    autoFocus
                    autoCorrect={false}
                    className="h-14 rounded-xl border-2 border-border bg-background pl-11 pr-3 text-base text-foreground"
                  />
                </View>
              </View>

              <FlatList
                data={locais}
                keyExtractor={(l) => l.id}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={{ paddingBottom: 24 }}
                ListHeaderComponent={
                  mostrarCadastrados && permiteEndereco ? (
                    <View className="bg-muted/40 px-4 py-2">
                      <Text className="text-sm font-semibold text-muted-foreground">
                        Já cadastrados
                      </Text>
                    </View>
                  ) : null
                }
                ListEmptyComponent={
                  mostrarCadastrados ? (
                    <Text className="px-4 py-6 text-center text-base text-muted-foreground">
                      {q.trim() ? "Nenhum local cadastrado com esse nome." : "Nenhum local cadastrado."}
                    </Text>
                  ) : null
                }
                ListFooterComponent={
                  <>
                    {locais.length < locaisTodos.length && (
                      <Text className="px-4 py-3 text-sm text-muted-foreground">
                        {`+${locaisTodos.length - locais.length} cadastrados — digite mais do nome pra achar.`}
                      </Text>
                    )}
                    {secaoEndereco}
                  </>
                }
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      onSelecionar(item);
                      fechar();
                    }}
                    className="flex-row items-start gap-3 border-b border-border px-4 py-4 active:bg-muted"
                  >
                    <View className="mt-0.5">
                      <MapPin size={18} color="#2563eb" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-foreground" numberOfLines={2}>
                        {formatarNomeLocal(item.nome)}
                      </Text>
                      <LinhaEndereco
                        endereco={enderecoResumido(item)}
                        cidade={item.cidade}
                        uf={item.uf}
                      />
                    </View>
                  </Pressable>
                )}
              />
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

