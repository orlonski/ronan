import { useEffect, useRef, useState } from "react";
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
import { Check, CheckCircle2, MapPin, Plus, Search, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { BuscarLocalModal } from "@/components/buscar-local-modal";
import { Label } from "@/components/ui/label";
import type { FonteGps } from "@ronan/shared-types";
import { marcoConflita } from "@ronan/shared-types";
import { showConfirm } from "@/lib/alert";
import {
  haversineMetros,
  mensagemGpsFalha,
  pegarCoordsPrecisa,
  RAIO_ALERTA_CARGA_M,
} from "@/lib/geo";
import { AvisoListaCache, AvisoLocalCache, enderecoResumido, LinhaEndereco } from "@/components/local-info";
import {
  buscarDescargaDuasEtapas,
  buscarDescargaDuasEtapasOffline,
  buscarLocaisProximos,
  buscarLocaisProximosOffline,
  useBuscaGpsConfig,
  useCriarLocalRapido,
  useMe,
  BUSCA_GPS_CONFIG_DEFAULTS,
  type Catalogos,
  type Local,
  type LocalProximo,
} from "@/lib/queries";

// `fetch` nativo do RN dispara TypeError("Network request failed") quando
// o device está offline. Detecta esse caso pra cair no fallback local.
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

// Raio (m) pro aviso "já existe um local aqui" na hora de cadastrar. Fixo e
// independente da config de busca (que serve a outro propósito): re-escaneia o
// catálogo cacheado ao redor do GPS. Alinha com a dedup do dashboard.
const RAIO_AVISO_DUPLICATA_M = 150;

// Coordenadas com precisão, carregadas pelos estados pra repassar na captura.
// buscaOffline: a busca de locais desse clique caiu no catálogo em cache.
type CoordsCap = {
  lat: number;
  lng: number;
  precisao: number | null;
  fonte: FonteGps;
  buscaOffline: boolean;
  /** Raio (m) em que o local foi achado na busca (inicial/ampliado). */
  raioUsadoM?: number;
};

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
  /** Fonte do sinal (PRECISA/BALANCED/CACHE) — vira Viagem.descargaFonte.
   *  Opcional: rascunho persistido antes da feature não tem. */
  fonte?: FonteGps;
  /** Raio (m) em que o local foi achado — vira Viagem.descargaRaioUsadoM. */
  raioUsadoM?: number;
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
  // Mostra o botão "Abrir ajustes" só quando a falha é de permissão (1 toque).
  const [erroAjustes, setErroAjustes] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  // Local vizinho que disparou a confirmação anti-duplicata inline (sem pop-up).
  const [confirmarPerto, setConfirmarPerto] = useState<LocalProximo | null>(null);
  // Busca por nome (todos os locais) — liberada por flag do motorista.
  const me = useMe();
  const podeBuscarPorNome = me.data?.podeVerTodosLocais ?? false;
  const [buscarAberto, setBuscarAberto] = useState(false);
  const criar = useCriarLocalRapido();
  const gpsConfig = useBuscaGpsConfig();
  const cfg = gpsConfig.data ?? BUSCA_GPS_CONFIG_DEFAULTS;
  const qc = useQueryClient();
  // Endereço completo não vem na busca de proximidade — cruza pelo id com o
  // catálogo em cache (que tem logradouro/bairro/cidade/uf). Snapshot ok: o
  // catálogo é estável durante o fluxo de seleção.
  const localDoCatalogo = (id: string) =>
    qc.getQueryData<Catalogos>(["catalogos"])?.locais.find((l) => l.id === id) ?? null;
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
    let raioAmpliadoM: number;
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
      raioAmpliadoM = res.raioAmpliadoM;
    } catch (err) {
      if (!isNetworkError(err)) {
        setErro((err as Error).message || "Erro ao buscar locais próximos");
        setEstado({ tipo: "vazio" });
        return;
      }
      buscaOffline = true;
      // Offline: busca no catálogo cacheado (2 etapas com os raios da config).
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
        raioInicialM: cfg.raioInicialM,
        raioAmpliadoM: cfg.raioAmpliadoM,
      });
      matches = res.locais;
      usouRaioAmpliado = res.usouRaioAmpliado;
      raioInicialM = res.raioInicialM;
      raioAmpliadoM = res.raioAmpliadoM;
      // Se nada veio do cache (lugar novo), cai no fluxo padrão de
      // sem_match abaixo — motorista digita o nome e o local entra no
      // outbox offline (pendingLocais). Não bloqueia mais.
    }

    // Raio em que o local foi achado (pra exibir e auditar). Só faz sentido
    // quando houve match; lugar novo (sem_match) não tem raio.
    const raioUsadoM =
      matches.length > 0 ? (usouRaioAmpliado ? raioAmpliadoM : raioInicialM) : undefined;
    const cap: CoordsCap = {
      lat: coords.lat,
      lng: coords.lng,
      precisao: coords.precisao,
      fonte: coords.fonte,
      buscaOffline,
      raioUsadoM,
    };
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
    setConfirmarPerto(null);
    const cap =
      estado.tipo === "escolha" || estado.tipo === "sem_match"
        ? estado.coords
        : undefined;
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

  // Seleção manual pela busca por nome: sem GPS fresco, então onCaptura(null) —
  // a viagem omite os campos descarga* de auditoria; o km segue do Local.lat/lng.
  function escolherLocalManual(local: Local) {
    onCaptura?.(null);
    onChange(local.id);
    setEstado({ tipo: "selecionado", local: { id: local.id, nome: local.nome } });
    setErro(null);
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
        raioM: cfg.raioAmpliadoM,
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
              raioM: cfg.raioAmpliadoM,
              limit: 8,
            })
          : [];
      }
    }
    if (outros.length > 0) {
      // "Ver outros" busca no raio ampliado — registra isso pra auditoria.
      const capAmpliado = { ...cap, raioUsadoM: cfg.raioAmpliadoM };
      setEstado({ tipo: "escolha", matches: outros, coords: capAmpliado, ampliado: true, raioInicialM: 0 });
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

  // Cria o local novo de fato (offline-first). Chamado só depois de passar pela
  // trava anti-duplicata (ou quando não há vizinho).
  async function criarLocalNovo() {
    if (estado.tipo !== "sem_match") return;
    const nome = nomeNovo.trim();
    if (nome.length < 2) return;
    setErro(null);
    try {
      const novo = await criar.mutateAsync({
        nome,
        lat: estado.coords.lat,
        lng: estado.coords.lng,
        precisao: estado.coords.precisao ?? undefined,
        fonte: estado.coords.fonte,
        tipo: "DESCARGA",
        clienteIds: clienteId ? [clienteId] : undefined,
      });
      onChange(novo.id);
      onCaptura?.({ ...estado.coords, distanciaMetros: 0 });
      setConfirmarPerto(null);
      setEstado({ tipo: "selecionado", local: { id: novo.id, nome: novo.nome } });
    } catch (err) {
      setErro((err as Error).message || "Erro ao criar o local");
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
    // Trava anti-duplicata INLINE (o pop-up abria ATRÁS deste Modal de tela
    // cheia): se tem local perto (marco-compatível), mostra a confirmação na
    // própria tela em vez de criar direto.
    const perto = matchesProximos.find((m) => !marcoConflita(nome, m.nome));
    if (perto) {
      setConfirmarPerto(perto);
      return;
    }
    void criarLocalNovo();
  }

  function trocar() {
    onChange("");
    onCaptura?.(null);
    setEstado({ tipo: "vazio" });
    setErro(null);
  }

  // Locais já cadastrados perto do GPS capturado (re-scan do catálogo cacheado,
  // offline, raio próprio de 150m). Base do aviso anti-duplicata no "cadastrar
  // novo" — independe da config de busca e do caminho até o sem_match.
  const semMatchCoords = estado.tipo === "sem_match" ? estado.coords : null;
  let matchesProximos: LocalProximo[] = [];
  if (semMatchCoords) {
    const catalogos = qc.getQueryData<Catalogos>(["catalogos"]);
    if (catalogos) {
      matchesProximos = buscarLocaisProximosOffline({
        lat: semMatchCoords.lat,
        lng: semMatchCoords.lng,
        locais: catalogos.locais,
        tipoUso: "descarga",
        raioM: RAIO_AVISO_DUPLICATA_M,
        limit: 5,
      });
    }
  }

  return (
    <View className="gap-2">
      <Label>Local de descarga</Label>

      {estado.tipo === "vazio" && (
        <View className="gap-2">
          <Button onPress={capturarEBuscar} size="lg" className="h-16">
            <MapPin size={22} color="white" />
            <Text className="text-base font-bold text-primary-foreground">
              Estou no local de descarga
            </Text>
          </Button>
          {podeBuscarPorNome && (
            <Button variant="outline" onPress={() => setBuscarAberto(true)}>
              <Search size={18} color="#0f172a" />
              <Text className="text-sm font-semibold text-foreground">
                Buscar local por nome
              </Text>
            </Button>
          )}
        </View>
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
              {(() => {
                const cat = localDoCatalogo(estado.local.id);
                return (
                  <LinhaEndereco
                    endereco={enderecoResumido(cat)}
                    cidade={cat?.cidade}
                    uf={cat?.uf}
                  />
                );
              })()}
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
              {estado.coords?.raioUsadoM != null && (
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  Achei este dentro de {estado.coords.raioUsadoM} m de você
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
          <AvisoLocalCache
            fonte={estado.coords?.fonte}
            buscaOffline={estado.coords?.buscaOffline}
          />
          {estado.coords ? (
            <Button variant="outline" onPress={verOutros} className="h-14">
              <MapPin size={20} color="#0f172a" />
              <Text className="text-base font-bold text-foreground">
                Não é esse? Ver outros locais
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
          {estado.coords?.buscaOffline && <AvisoListaCache />}
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
          {podeBuscarPorNome && (
            <Button variant="outline" onPress={() => setBuscarAberto(true)} className="mt-1">
              <Search size={18} color="#0f172a" />
              <Text className="text-sm font-semibold text-foreground">
                Buscar local por nome
              </Text>
            </Button>
          )}
          <Button variant="warning" onPress={abrirSemMatch} className="mt-1 h-14">
            <Plus size={20} color="#0f172a" />
            <Text className="text-base font-bold text-warning-foreground">
              Nenhum é o certo — cadastrar novo lugar
            </Text>
          </Button>
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

      {/* Modal full-screen: pedir nome quando sem match.
          Full-screen (não bottom-sheet transparent) pra Android adjustResize
          funcionar e o teclado não sobrepor o input. */}
      <Modal
        visible={estado.tipo === "sem_match"}
        animationType="slide"
        onRequestClose={() => {
          if (estado.tipo === "sem_match") {
            setConfirmarPerto(null);
            setEstado({ tipo: "vazio" });
          }
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
                onPress={() => {
                  setConfirmarPerto(null);
                  setEstado({ tipo: "vazio" });
                }}
                className="h-10 w-10 items-center justify-center rounded-full bg-muted"
              >
                <X size={20} color="#0f172a" />
              </Pressable>
            </View>

            {confirmarPerto ? (
              /* Confirmação INLINE (sem pop-up, que abriria atrás deste Modal).
                 Nudge pro seguro: "É este" grande; "criar novo" discreto. */
              <View className="flex-1 justify-center gap-5 p-6">
                <Text className="text-center text-4xl">⚠️</Text>
                <Text className="text-center text-2xl font-bold text-foreground">
                  Opa! Já tem um local aqui
                </Text>
                <View className="gap-1 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                  <Text className="text-center text-lg font-bold text-amber-900">
                    {confirmarPerto.nome}
                  </Text>
                  <Text className="text-center text-base text-amber-800">
                    fica a só {Math.round(confirmarPerto.distanciaMetros)} m de você
                  </Text>
                </View>
                <Text className="text-center text-base text-muted-foreground">
                  Provavelmente é esse mesmo. Tem certeza que quer criar um local
                  NOVO em vez de usar ele?
                </Text>
              </View>
            ) : (
            <View className="flex-1 gap-4 p-5">
              {matchesProximos.length > 0 && (
                <View className="gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <Text className="text-sm font-bold text-amber-900">
                    ⚠️ Já tem local cadastrado bem aqui
                  </Text>
                  <Text className="text-xs text-amber-800">
                    Confira se não é um destes antes de criar um novo:
                  </Text>
                  {matchesProximos.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => escolherMatch(m)}
                      className="flex-row items-center justify-between rounded-lg border border-amber-300 bg-background px-3 py-2.5"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                          {m.nome}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          a {Math.round(m.distanciaMetros)} m daqui
                        </Text>
                      </View>
                      <View className="rounded-full bg-primary px-3 py-1.5">
                        <Text className="text-xs font-bold text-primary-foreground">
                          É este
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text className="text-sm text-muted-foreground">
                {matchesProximos.length > 0
                  ? "Se for mesmo um lugar novo, dá um nome:"
                  : "Não conheço esse lugar aqui — me ajuda dando um nome rápido."}
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
            )}

            {confirmarPerto ? (
              <View className="gap-3 border-t border-border p-4">
                <Button
                  variant="success"
                  size="lg"
                  className="h-16"
                  onPress={() => escolherMatch(confirmarPerto)}
                >
                  <CheckCircle2 size={22} color="#fff" />
                  <Text className="text-base font-bold text-success-foreground">
                    É esse mesmo — usar este local
                  </Text>
                </Button>
                <Button
                  variant="warning"
                  className="h-14"
                  onPress={() => void criarLocalNovo()}
                  loading={criar.isPending}
                >
                  <Plus size={20} color="#0f172a" />
                  <Text className="text-base font-bold text-warning-foreground">
                    Não é esse — criar um local novo
                  </Text>
                </Button>
              </View>
            ) : (
              <View className="flex-row gap-3 border-t border-border p-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => setEstado({ tipo: "vazio" })}
                >
                  <X size={18} color="#0f172a" />
                  <Text className="text-base font-medium text-foreground">Cancelar</Text>
                </Button>
                <Button
                  className="flex-1"
                  onPress={salvarNomeNovo}
                  loading={criar.isPending}
                >
                  <Check size={20} color="#fff" />
                  <Text className="text-base font-bold text-primary-foreground">
                    Salvar local
                  </Text>
                </Button>
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <BuscarLocalModal
        visible={buscarAberto}
        onClose={() => setBuscarAberto(false)}
        onSelecionar={escolherLocalManual}
      />
    </View>
  );
}
