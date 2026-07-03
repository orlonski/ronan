import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import type { FonteGps } from "@ronan/shared-types";
import { Label } from "@/components/ui/label";
import { showConfirm } from "@/lib/alert";
import { mensagemGpsFalha, pegarCoordsPrecisa } from "@/lib/geo";
import { AvisoListaCache, AvisoLocalCache, enderecoResumido, LinhaEndereco } from "@/components/local-info";
import {
  buscarDescargaDuasEtapas,
  buscarDescargaDuasEtapasOffline,
  buscarLocaisProximos,
  buscarLocaisProximosOffline,
  useBuscaGpsConfig,
  BUSCA_GPS_CONFIG_DEFAULTS,
  type Catalogos,
  type LocalProximo,
} from "@/lib/queries";

// `fetch` nativo do RN dispara TypeError("Network request failed") offline.
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

// Snapshot com precisão pra repassar na seleção final.
type CoordsCap = {
  lat: number;
  lng: number;
  precisao: number | null;
  fonte: FonteGps;
  buscaOffline: boolean;
  raioUsadoM?: number;
};

type Estado =
  | { tipo: "vazio" }
  | { tipo: "capturando"; precisao: number | null }
  | { tipo: "selecionado"; local: SelecaoLocal }
  | {
      tipo: "escolha";
      matches: LocalProximo[];
      coords: CoordsCap;
      ampliado: boolean;
      raioInicialM: number;
    }
  | { tipo: "sem_match"; coords: CoordsCap }
  // Carga sem match: não pode criar nem listar tudo — bloqueia (usar Nova viagem).
  | { tipo: "bloqueado" };

/**
 * Local escolhido/detectado por GPS. `criarOffline` = lugar novo que o
 * motorista nomeou; o caller (registrarEventoGuiado) enfileira o Local.
 * `lat/lng` acompanham pra snapshot e criação offline.
 */
export type SelecaoLocal = {
  id: string;
  nome: string;
  lat?: number;
  lng?: number;
  precisao?: number | null;
  /** Fonte do sinal (PRECISA/BALANCED/CACHE) da captura. */
  fonte?: FonteGps;
  /** Raio (m) em que o local foi achado na busca (só descarga). */
  raioUsadoM?: number;
  distanciaMetros?: number | null;
  criarOffline?: boolean;
  buscaOffline?: boolean;
};

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Captura GPS preciso e busca locais cadastrados próximos (2 etapas, fallback
 * offline, modal "como chama esse lugar?" pra criar local novo). Versão
 * genérica do fluxo do DescargaPorGps, parametrizada pelo lado (carga/descarga)
 * e reportando a SELEÇÃO ao caller (não cria o local — quem enfileira é o
 * registrarEventoGuiado, que já sabe montar o payload do lifecycle).
 */
export function LocalPorGps({
  lado,
  ctaLabel,
  clienteId,
  value,
  onSelect,
  onLimpar,
}: {
  lado: "carga" | "descarga";
  /** Texto do botão grande (ex: "Estou no local de carga"). */
  ctaLabel: string;
  clienteId?: string | null;
  /** Seleção atual (pra reidratar o cartão verde). */
  value?: SelecaoLocal | null;
  onSelect: (sel: SelecaoLocal) => void;
  onLimpar?: () => void;
}) {
  const [estado, setEstado] = useState<Estado>(() =>
    value ? { tipo: "selecionado", local: value } : { tipo: "vazio" },
  );
  const [erro, setErro] = useState<string | null>(null);
  // Mostra o botão "Abrir ajustes" só quando a falha é de permissão (1 toque).
  const [erroAjustes, setErroAjustes] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const gpsConfig = useBuscaGpsConfig();
  const cfg = gpsConfig.data ?? BUSCA_GPS_CONFIG_DEFAULTS;
  const qc = useQueryClient();
  // Endereço completo vem do catálogo em cache (a busca de proximidade não traz).
  const localDoCatalogo = (id: string) =>
    qc.getQueryData<Catalogos>(["catalogos"])?.locais.find((l) => l.id === id) ?? null;

  // Carga é sempre um cadastro existente do cliente — o motorista NUNCA cria
  // local de carga. Só descarga (obra do cliente) permite lugar novo.
  const permiteCriar = lado === "descarga";

  async function capturarEBuscar() {
    setErro(null);
    setErroAjustes(false);
    setEstado({ tipo: "capturando", precisao: null });
    const res = await pegarCoordsPrecisa({
      alvoMetros: cfg.gpsAlvoMetros,
      maxMs: cfg.gpsMaxSegundos * 1000,
      onAmostra: (precisao) => setEstado({ tipo: "capturando", precisao }),
    });
    if (!res.ok) {
      const { msg, ajustes } = mensagemGpsFalha(res.motivo);
      setEstado({ tipo: "vazio" });
      setErro(msg);
      setErroAjustes(ajustes);
      return;
    }
    const coords = res.coords;

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

    let matches: LocalProximo[];
    let usouRaioAmpliado: boolean;
    let raioInicialM: number;
    let raioAmpliadoM = cfg.raioAmpliadoM;
    let buscaOffline = false;
    try {
      if (lado === "descarga") {
        const res = await buscarDescargaDuasEtapas({
          lat: coords.lat,
          lng: coords.lng,
          limit: 5,
        });
        matches = res.locais;
        usouRaioAmpliado = res.usouRaioAmpliado;
        raioInicialM = res.raioInicialM;
        raioAmpliadoM = res.raioAmpliadoM;
      } else {
        // Carga: busca por proximidade filtrando por tipo carga E cliente
        // (vinculados a ele + genéricos). Nunca cria/lista tudo.
        matches = await buscarLocaisProximos({
          lat: coords.lat,
          lng: coords.lng,
          tipoUso: "carga",
          clienteId: clienteId ?? undefined,
          limit: 5,
        });
        usouRaioAmpliado = false;
        raioInicialM = 0;
      }
    } catch (err) {
      if (!isNetworkError(err)) {
        setErro((err as Error).message || "Erro ao buscar locais próximos");
        setEstado({ tipo: "vazio" });
        return;
      }
      buscaOffline = true;
      const catalogos = qc.getQueryData<Catalogos>(["catalogos"]);
      if (!catalogos) {
        setErro(
          "Sem internet e sem catálogo carregado. Abra o app com sinal pelo menos uma vez antes.",
        );
        setEstado({ tipo: "vazio" });
        return;
      }
      if (lado === "descarga") {
        const res = buscarDescargaDuasEtapasOffline({
          lat: coords.lat,
          lng: coords.lng,
          locais: catalogos.locais,
          limit: 5,
          raioInicialM: cfg.raioInicialM,
          raioAmpliadoM: cfg.raioAmpliadoM,
        });
        matches = res.locais;
        usouRaioAmpliado = res.usouRaioAmpliado;
        raioInicialM = res.raioInicialM;
        raioAmpliadoM = res.raioAmpliadoM;
      } else {
        matches = buscarLocaisProximosOffline({
          lat: coords.lat,
          lng: coords.lng,
          locais: catalogos.locais,
          tipoUso: "carga",
          clienteId: clienteId ?? undefined,
          raioM: cfg.raioInicialM,
        });
        usouRaioAmpliado = false;
        raioInicialM = 0;
      }
    }

    // Raio em que o local foi achado (descarga; carga não tem 2 etapas).
    const raioUsadoM =
      lado === "descarga" && matches.length > 0
        ? usouRaioAmpliado
          ? raioAmpliadoM
          : raioInicialM
        : undefined;
    const cap: CoordsCap = {
      lat: coords.lat,
      lng: coords.lng,
      precisao: coords.precisao,
      fonte: coords.fonte,
      buscaOffline,
      raioUsadoM,
    };
    if (matches.length === 0) {
      if (permiteCriar) {
        setEstado({ tipo: "sem_match", coords: cap });
        setNomeNovo("");
      } else {
        // Carga: nada do cliente por perto → bloqueia (usar Nova viagem).
        setEstado({ tipo: "bloqueado" });
      }
    } else if (matches.length === 1 && !usouRaioAmpliado) {
      const m = matches[0]!;
      selecionar(m, cap);
    } else {
      setEstado({ tipo: "escolha", matches, coords: cap, ampliado: usouRaioAmpliado, raioInicialM });
    }
  }

  function selecionar(m: LocalProximo, cap: CoordsCap) {
    const sel: SelecaoLocal = {
      id: m.id,
      nome: m.nome,
      lat: m.lat ?? undefined,
      lng: m.lng ?? undefined,
      precisao: cap.precisao,
      fonte: cap.fonte,
      raioUsadoM: cap.raioUsadoM,
      distanciaMetros: m.distanciaMetros,
      buscaOffline: cap.buscaOffline,
    };
    onSelect(sel);
    setEstado({ tipo: "selecionado", local: sel });
  }

  function escolherMatch(m: LocalProximo) {
    if (estado.tipo === "escolha") selecionar(m, estado.coords);
  }

  function abrirSemMatch() {
    if (estado.tipo === "escolha") {
      setEstado({ tipo: "sem_match", coords: estado.coords });
      setNomeNovo("");
    }
  }

  function salvarNomeNovo() {
    if (estado.tipo !== "sem_match") return;
    const nome = nomeNovo.trim();
    if (nome.length < 2) {
      setErro("Digite um nome de pelo menos 2 letras.");
      return;
    }
    setErro(null);
    // Local novo offline: gera id, marca criarOffline. registrarEventoGuiado
    // enfileira o Local (enqueueLocal) antes do evento.
    const sel: SelecaoLocal = {
      id: uuid(),
      nome,
      lat: estado.coords.lat,
      lng: estado.coords.lng,
      precisao: estado.coords.precisao,
      fonte: estado.coords.fonte,
      distanciaMetros: 0,
      criarOffline: true,
      buscaOffline: estado.coords.buscaOffline,
    };
    onSelect(sel);
    setEstado({ tipo: "selecionado", local: sel });
  }

  function trocar() {
    onLimpar?.();
    setEstado({ tipo: "vazio" });
    setErro(null);
  }

  const labelTexto = lado === "carga" ? "Local de carga" : "Local de descarga";

  return (
    <View className="gap-2">
      <Label>{labelTexto}</Label>

      {estado.tipo === "vazio" && (
        <Button onPress={capturarEBuscar} size="lg" className="h-16">
          <MapPin size={22} color="white" />
          <Text className="text-base font-bold text-primary-foreground">
            {ctaLabel}
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

      {estado.tipo === "selecionado" && (
        <View className="flex-row items-start gap-3 rounded-2xl border-2 border-success/40 bg-success/15 p-4">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-success">
            <CheckCircle2 size={20} color="white" strokeWidth={2.5} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-bold text-foreground" numberOfLines={2}>
              {estado.local.nome}
            </Text>
            {!estado.local.criarOffline &&
              (() => {
                const cat = localDoCatalogo(estado.local.id);
                return (
                  <LinhaEndereco
                    endereco={enderecoResumido(cat)}
                    cidade={cat?.cidade}
                    uf={cat?.uf}
                  />
                );
              })()}
            {estado.local.raioUsadoM != null && !estado.local.criarOffline && (
              <Text className="mt-0.5 text-xs text-muted-foreground">
                Achei este dentro de {estado.local.raioUsadoM} m de você
              </Text>
            )}
            {estado.local.distanciaMetros != null && (
              <Text
                className="mt-0.5 text-sm text-muted-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {estado.local.criarOffline
                  ? "local novo — GPS gravado"
                  : `${estado.local.distanciaMetros}m do GPS`}
              </Text>
            )}
            <AvisoLocalCache
              fonte={estado.local.fonte}
              buscaOffline={estado.local.buscaOffline}
            />
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
        <View
          className={`gap-2 rounded-2xl border-2 bg-card p-3 ${estado.ampliado ? "border-warning/50" : "border-border"}`}
        >
          {estado.ampliado ? (
            <Text className="text-sm font-medium text-foreground">
              Não achei nada a {estado.raioInicialM}m de você. Um pouco mais longe tem{" "}
              {estado.matches.length === 1 ? "este" : `estes ${estado.matches.length}`} — é
              algum deles?
            </Text>
          ) : (
            <Text className="text-sm font-medium text-foreground">
              Achei {estado.matches.length} perto. Qual é?
            </Text>
          )}
          {estado.coords.buscaOffline && <AvisoListaCache />}
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
                {(() => {
                  const end = enderecoResumido(localDoCatalogo(m.id));
                  return end ? (
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {end}
                    </Text>
                  ) : null;
                })()}
              </View>
            </Pressable>
          ))}
          {permiteCriar ? (
            <Button variant="outline" onPress={abrirSemMatch} className="mt-1">
              <Plus size={18} color="#0f172a" />
              <Text className="text-sm font-semibold text-foreground">
                Nenhum desses — criar novo
              </Text>
            </Button>
          ) : (
            <Button variant="outline" onPress={() => void capturarEBuscar()} className="mt-1">
              <MapPin size={18} color="#0f172a" />
              <Text className="text-sm font-semibold text-foreground">
                Nenhum desses — tentar de novo
              </Text>
            </Button>
          )}
        </View>
      )}

      {/* Carga sem local do cliente por perto — bloqueia (usar Nova viagem). */}
      {estado.tipo === "bloqueado" && (
        <View className="gap-3 rounded-2xl border-2 border-warning/50 bg-warning/10 p-4">
          <Text className="text-base font-bold text-foreground">
            Nenhum local de carga desse cliente aqui perto
          </Text>
          <Text className="text-sm text-muted-foreground">
            Pra iniciar essa viagem, use o menu <Text className="font-semibold">Nova viagem</Text>.
            Aqui a carga precisa ser um local já cadastrado do cliente, achado pela sua posição.
          </Text>
          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => setEstado({ tipo: "vazio" })}>
              <Text className="text-sm font-medium text-foreground">Voltar</Text>
            </Button>
            <Button className="flex-1" onPress={() => void capturarEBuscar()}>
              <MapPin size={18} color="white" />
              <Text className="text-sm font-bold text-primary-foreground">Tentar de novo</Text>
            </Button>
          </View>
        </View>
      )}

      {erro && (
        <View className="gap-2">
          <Text className="text-sm text-destructive">{erro}</Text>
          {erroAjustes && (
            <Button variant="outline" onPress={() => void Linking.openSettings()}>
              <Text className="text-sm font-semibold text-foreground">Abrir ajustes</Text>
            </Button>
          )}
        </View>
      )}

      {/* Modal full-screen: nomear lugar novo. */}
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
                  placeholder={
                    lado === "carga"
                      ? 'ex: "Pedreira X", "Usina Y"'
                      : 'ex: "Obra do shopping", "Construtora X"'
                  }
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
              <Button className="flex-1" onPress={salvarNomeNovo}>
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
