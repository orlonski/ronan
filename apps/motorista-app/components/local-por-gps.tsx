import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Check, CheckCircle2, MapPin, Plus, Search, X } from "lucide-react-native";
import { BuscarLocalModal } from "@/components/buscar-local-modal";
import { useLigadaPelaEmpresa } from "@/lib/acessos-app";
import { Button } from "@/components/ui/button";
import type { FonteGps } from "@ronan/shared-types";
import {
  formatarNomeLocal,
  rankearCandidatosDuplicata,
  type CandidatoDuplicata,
  type CandidatoRankeado,
} from "@ronan/shared-types";
import { Label } from "@/components/ui/label";
import { showConfirm } from "@/lib/alert";
import { formatarDistancia, haversineMetros, mensagemGpsFalha, pegarCoordsPrecisa } from "@/lib/geo";
import { AvisoListaCache, AvisoLocalCache, enderecoResumido, LinhaEndereco } from "@/components/local-info";
import {
  buscarDescargaDuasEtapas,
  buscarDescargaDuasEtapasOffline,
  buscarLocaisProximos,
  buscarLocaisProximosOffline,
  useBuscaGpsConfig,
  useMe,
  BUSCA_GPS_CONFIG_DEFAULTS,
  type Catalogos,
  type Local,
  type LocalProximo,
} from "@/lib/queries";

// `fetch` nativo do RN dispara TypeError("Network request failed") offline.
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

// Raio (m) do scan anti-duplicata ao cadastrar. Amplo de propósito, como no
// DescargaPorGps: quem decide o que é forte é o ranqueador (proximidade +
// parecença de NOME + já-visto), não a distância sozinha.
const RAIO_SCAN_DUPLICATA_M = 500;

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
  // Carga: cliente sem NENHUM local de carga cadastrado (não é mais trava de raio).
  // Guarda o GPS: a busca de endereço ainda pode resolver daqui.
  | { tipo: "bloqueado"; coords: CoordsCap };

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
  /** Raio (m) em que o local foi achado na busca. */
  raioUsadoM?: number;
  distanciaMetros?: number | null;
  /** GPS REAL do motorista na captura (≠ lat/lng, que são do local). Usado pra
   * gravar cargaLat/cargaLng e alimentar o mini-mapa "você × local". */
  gpsLat?: number;
  gpsLng?: number;
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
  autoIniciar,
  direto,
}: {
  lado: "carga" | "descarga";
  /** Texto do botão grande (ex: "Estou no local de carga"). */
  ctaLabel: string;
  clienteId?: string | null;
  /** Seleção atual (pra reidratar o cartão verde). */
  value?: SelecaoLocal | null;
  onSelect: (sel: SelecaoLocal) => void;
  onLimpar?: () => void;
  /** Dispara a captura do GPS já no mount (quem abriu já pediu "estou aqui"). */
  autoIniciar?: boolean;
  /** Vai direto pro "Como chama esse lugar?" depois do GPS, sem a lista: quem
   * abriu já viu a lista e disse que o local não está nela. Os que estão perto
   * aparecem como "talvez já exista" embaixo do nome. Só com permiteCriar. */
  direto?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>(() =>
    value ? { tipo: "selecionado", local: value } : { tipo: "vazio" },
  );
  const [erro, setErro] = useState<string | null>(null);
  // Mostra o botão "Abrir ajustes" só quando a falha é de permissão (1 toque).
  const [erroAjustes, setErroAjustes] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  // Local vizinho que disparou a confirmação anti-duplicata inline (sem pop-up).
  const [confirmarPerto, setConfirmarPerto] = useState<LocalProximo | null>(null);
  // Locais que ele ACABOU de ver na lista: entram no ranqueador como "já visto"
  // (quem passou pelo certo e mesmo assim foi cadastrar é o caso a pegar).
  const matchesVistosRef = useRef<LocalProximo[]>([]);
  // Carga: a lista abre só com os locais PERTO (raio ampliado do painel); os
  // longe do mesmo cliente ficam atrás de um toque — 7 locais espalhados pela
  // região poluíam a tela de quem está parado num deles.
  const [mostrarTodos, setMostrarTodos] = useState(false);

  // Trocar de cliente invalida a lista/seleção (eram locais do cliente anterior).
  // O estado interno não segue `value`, então reseta ao mudar o clienteId — senão
  // ficava mostrando os locais do cliente antigo.
  const clienteIdRef = useRef(clienteId);
  useEffect(() => {
    if (clienteIdRef.current === clienteId) return;
    clienteIdRef.current = clienteId;
    setEstado({ tipo: "vazio" });
    setErro(null);
    setErroAjustes(false);
  }, [clienteId]);

  const gpsConfig = useBuscaGpsConfig();
  const cfg = gpsConfig.data ?? BUSCA_GPS_CONFIG_DEFAULTS;
  const qc = useQueryClient();
  // Endereço completo vem do catálogo em cache (a busca de proximidade não traz).
  const localDoCatalogo = (id: string) =>
    qc.getQueryData<Catalogos>(["catalogos"])?.locais.find((l) => l.id === id) ?? null;

  // Carga normalmente é um cadastro existente do cliente (pedreira, pátio): o
  // motorista só cria local de carga se a empresa ligar (nasce desligado).
  // Descarga (obra do cliente) sempre permite lugar novo.
  const podeCadastrarCarga = useLigadaPelaEmpresa("app.locais.cadastrarCarga");
  const permiteCriar = lado === "descarga" || podeCadastrarCarga;

  // Exceção que a empresa liga (nasce desligada): achar o endereço no mapa
  // quando o local não está cadastrado — inclusive o de carga. O local novo
  // nasce em RASCUNHO e o escritório confere em "Em validação".
  const podeBuscarEndereco = useLigadaPelaEmpresa("app.locais.buscarEndereco");
  const me = useMe();
  const podeVerTodos = me.data?.podeVerTodosLocais ?? false;
  const [buscaAberta, setBuscaAberta] = useState(false);

  function escolherDaBusca(l: Local) {
    if (estado.tipo !== "escolha" && estado.tipo !== "bloqueado") return;
    const cap = estado.coords;
    const dist =
      l.lat != null && l.lng != null ? Math.round(haversineMetros(cap.lat, cap.lng, l.lat, l.lng)) : null;
    const sel: SelecaoLocal = {
      id: l.id,
      nome: l.nome,
      lat: l.lat ?? undefined,
      lng: l.lng ?? undefined,
      precisao: cap.precisao,
      fonte: cap.fonte,
      // Veio da busca, não do raio do GPS: gravar o raio mentiria na auditoria.
      raioUsadoM: undefined,
      distanciaMetros: dist,
      gpsLat: cap.lat,
      gpsLng: cap.lng,
      buscaOffline: cap.buscaOffline,
    };
    onSelect(sel);
    setEstado({ tipo: "selecionado", local: sel });
  }

  const autoIniciouRef = useRef(false);
  useEffect(() => {
    if (!autoIniciar || autoIniciouRef.current || estado.tipo !== "vazio") return;
    autoIniciouRef.current = true;
    void capturarEBuscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoIniciar]);

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
        // Carga: SEMPRE lista TODOS os locais de carga do cliente, ordenados por
        // distância (mais perto primeiro). O motorista escolhe — o raio é só
        // ordenação, não trava nem auto-seleciona.
        raioInicialM = cfg.raioInicialM;
        raioAmpliadoM = cfg.raioAmpliadoM;
        matches = await buscarLocaisProximos({
          lat: coords.lat,
          lng: coords.lng,
          tipoUso: "carga",
          clienteId: clienteId ?? undefined,
          limit: 20,
          todos: true,
        });
        usouRaioAmpliado = false;
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
        // Carga offline: mesma ideia — todos os locais do cliente por distância.
        raioInicialM = cfg.raioInicialM;
        raioAmpliadoM = cfg.raioAmpliadoM;
        matches = buscarLocaisProximosOffline({
          lat: coords.lat,
          lng: coords.lng,
          locais: catalogos.locais,
          tipoUso: "carga",
          clienteId: clienteId ?? undefined,
          limit: 20,
          todos: true,
        });
        usouRaioAmpliado = false;
      }
    }

    // Ordem pedida: mais perto primeiro. Backend e offline já ordenam, mas isso
    // reforça caso alguma origem venha fora de ordem.
    matches = [...matches].sort((a, b) => a.distanciaMetros - b.distanciaMetros);

    // Raio usado: descarga = raio em que achou (inicial/ampliado). Carga = o raio
    // ampliado da config como referência de "perto" (a lista traz todos; isso só
    // define o corte do "fora do raio" no painel).
    const raioUsadoM =
      lado === "carga"
        ? cfg.raioAmpliadoM
        : matches.length > 0
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
    // "Já visto" = o que aparece na tela. Carga lista todos os locais do cliente,
    // mas só mostra os perto; no `direto` ele não vê lista nenhuma.
    matchesVistosRef.current =
      direto && permiteCriar
        ? []
        : lado === "carga"
          ? matches.filter((m) => m.distanciaMetros <= cfg.raioAmpliadoM)
          : matches;
    setMostrarTodos(false);
    if (direto && permiteCriar) {
      setEstado({ tipo: "sem_match", coords: cap });
      setNomeNovo("");
    } else if (matches.length === 0) {
      if (permiteCriar) {
        setEstado({ tipo: "sem_match", coords: cap });
        setNomeNovo("");
      } else {
        // Carga: nem no modo "todos" veio nada → o cliente não tem NENHUM local
        // de carga cadastrado (raio já não bloqueia; isso é falta de cadastro).
        setEstado({ tipo: "bloqueado", coords: cap });
      }
    } else if (lado === "descarga" && matches.length === 1 && !usouRaioAmpliado) {
      // Só a descarga auto-seleciona quando há 1 match no raio inicial. Carga
      // sempre lista (o motorista escolhe entre os locais do cliente).
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
      gpsLat: cap.lat,
      gpsLng: cap.lng,
      buscaOffline: cap.buscaOffline,
    };
    onSelect(sel);
    setEstado({ tipo: "selecionado", local: sel });
  }

  function escolherMatch(m: LocalProximo) {
    setConfirmarPerto(null);
    if (estado.tipo === "escolha" || estado.tipo === "sem_match") {
      selecionar(m, estado.coords);
    }
  }

  function abrirSemMatch() {
    if (estado.tipo === "escolha") {
      setEstado({ tipo: "sem_match", coords: estado.coords });
      setNomeNovo("");
    }
  }

  // Cria o local novo de fato. Só depois de passar pela trava anti-duplicata.
  function criarLocalNovo() {
    if (estado.tipo !== "sem_match") return;
    const nome = nomeNovo.trim();
    if (nome.length < 2) return;
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
    setConfirmarPerto(null);
    onSelect(sel);
    setEstado({ tipo: "selecionado", local: sel });
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
    // cheia): se o topo do rank é um candidato de confiança média/alta,
    // confirma na própria tela. Nunca bloqueia.
    const topo = candidatosDuplicata[0];
    const perto = topo ? localPorId.get(topo.id) : undefined;
    if (perto) {
      setConfirmarPerto(perto);
      return;
    }
    criarLocalNovo();
  }

  function trocar() {
    onLimpar?.();
    setEstado({ tipo: "vazio" });
    setErro(null);
  }

  const labelTexto = lado === "carga" ? "Local de carga" : "Local de descarga";

  // Candidatos a "mesmo lugar" ao cadastrar novo: vizinhos no catálogo em cache
  // (offline, raio amplo) + os que ele acabou de ver, ranqueados por
  // proximidade + PARECENÇA DE NOME + já-visto + uso — a mesma régua do
  // DescargaPorGps. Recomputa a cada tecla (o nome entra na similaridade).
  const semMatchCoords = estado.tipo === "sem_match" ? estado.coords : null;
  const localPorId = new Map<string, LocalProximo>();
  let candidatosDuplicata: CandidatoRankeado[] = [];
  if (semMatchCoords) {
    const catalogos = qc.getQueryData<Catalogos>(["catalogos"]);
    const geo = catalogos
      ? buscarLocaisProximosOffline({
          lat: semMatchCoords.lat,
          lng: semMatchCoords.lng,
          locais: catalogos.locais,
          tipoUso: lado,
          raioM: RAIO_SCAN_DUPLICATA_M,
          limit: 8,
        })
      : [];
    for (const m of geo) localPorId.set(m.id, m);
    for (const m of matchesVistosRef.current) {
      if (!localPorId.has(m.id)) localPorId.set(m.id, m);
    }
    const candidatos: CandidatoDuplicata[] = [...localPorId.values()].map((m) => ({
      id: m.id,
      nome: m.nome,
      distanciaM:
        m.lat != null && m.lng != null
          ? Math.round(haversineMetros(semMatchCoords.lat, semMatchCoords.lng, m.lat, m.lng))
          : (m.distanciaMetros ?? null),
      vezesUsado: m.vezesUsadoMotorista,
      jaVisto: matchesVistosRef.current.some((v) => v.id === m.id),
    }));
    candidatosDuplicata = rankearCandidatosDuplicata({
      nomeDigitado: nomeNovo,
      candidatos,
    }).filter((c) => c.confianca !== "baixa");
  }
  // Lista da carga: perto primeiro (raio ampliado), os longe sob demanda.
  const matchesEscolha = estado.tipo === "escolha" ? estado.matches : [];
  const cargaPerto = matchesEscolha.filter((m) => m.distanciaMetros <= cfg.raioAmpliadoM);
  const cargaVisiveis = mostrarTodos ? matchesEscolha : cargaPerto;
  const cargaLonge = matchesEscolha.length - cargaVisiveis.length;

  const matchesProximos = candidatosDuplicata
    .map((c) => localPorId.get(c.id))
    .filter((m): m is LocalProximo => m != null)
    .slice(0, 5);

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
              {formatarNomeLocal(estado.local.nome)}
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
            {lado === "descarga" &&
              estado.local.raioUsadoM != null &&
              !estado.local.criarOffline && (
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
          {lado === "carga" ? (
            <Text className="text-sm font-medium text-foreground">
              {cargaVisiveis.length === 0
                ? "Nenhum local de carga desse cliente perto de você."
                : cargaVisiveis.length === 1
                  ? "Achei este perto de você. É ele?"
                  : `Achei ${cargaVisiveis.length} perto de você. Qual é?`}
            </Text>
          ) : estado.ampliado ? (
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
          {(lado === "carga" ? cargaVisiveis : estado.matches).map((m, i) => (
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
                  {formatarNomeLocal(m.nome)}
                </Text>
                <Text
                  className="text-xs text-muted-foreground"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  a {formatarDistancia(m.distanciaMetros)} de você · {m.cidade}/{m.uf}
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
          {lado === "carga" && cargaLonge > 0 && (
            <Button
              variant="outline"
              onPress={() => {
                // Agora ele viu todos: entram no "já visto" (o teto de distância
                // do ranqueador segura os de outra região).
                matchesVistosRef.current = matchesEscolha;
                setMostrarTodos(true);
              }}
              className="mt-1"
            >
              <MapPin size={18} color="#0f172a" />
              <Text className="text-sm font-semibold text-foreground">
                {cargaVisiveis.length === 0
                  ? `Ver os ${cargaLonge} locais do cliente`
                  : `Ver os outros ${cargaLonge} locais do cliente`}
              </Text>
            </Button>
          )}
          {podeBuscarEndereco && (
            <Button variant="outline" onPress={() => setBuscaAberta(true)} className="mt-1">
              <Search size={18} color="#0f172a" />
              <Text className="text-sm font-semibold text-foreground">
                Não está na lista? Buscar endereço
              </Text>
            </Button>
          )}
          {permiteCriar ? (
            <Button variant="warning" onPress={abrirSemMatch} className="mt-1 h-14">
              <Plus size={20} color="#0f172a" />
              <Text className="text-base font-bold text-warning-foreground">
                Nenhum é o certo — cadastrar novo lugar
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

      {/* Carga: cliente sem local de carga cadastrado (não é mais trava de raio). */}
      {estado.tipo === "bloqueado" && (
        <View className="gap-3 rounded-2xl border-2 border-warning/50 bg-warning/10 p-4">
          <Text className="text-base font-bold text-foreground">
            Esse cliente não tem local de carga cadastrado
          </Text>
          {podeBuscarEndereco ? (
            <Text className="text-sm text-muted-foreground">
              Busque o endereço no mapa — o escritório confere o local depois.
            </Text>
          ) : (
            <Text className="text-sm text-muted-foreground">
              A carga precisa ser um local já cadastrado do cliente. Fale com o escritório pra
              cadastrar o local de carga, ou use o <Text className="font-semibold">Lançar viagem feita</Text>.
            </Text>
          )}
          {podeBuscarEndereco && (
            <Button onPress={() => setBuscaAberta(true)}>
              <Search size={18} color="white" />
              <Text className="text-base font-bold text-primary-foreground">Buscar endereço</Text>
            </Button>
          )}
          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => setEstado({ tipo: "vazio" })}>
              <ArrowLeft size={18} color="#0f172a" />
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

      {podeBuscarEndereco && (
        <BuscarLocalModal
          visible={buscaAberta}
          onClose={() => setBuscaAberta(false)}
          onSelecionar={escolherDaBusca}
          lado={lado}
          clienteId={clienteId}
          // Carga: a lista do cliente já é toda visível. Descarga: o catálogo
          // inteiro só pra quem tem "Buscar local pelo nome".
          mostrarCadastrados={lado === "carga" || podeVerTodos}
          permiteEndereco
          coords={estado.tipo === "escolha" || estado.tipo === "bloqueado" ? estado.coords : null}
        />
      )}

      {/* Modal full-screen: nomear lugar novo. */}
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
            // Edge-to-edge (SDK 54): o Android não redimensiona a janela com o
            // teclado — "height" deixava o campo e os botões por baixo dele.
            behavior="padding"
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
              <View className="flex-1 justify-center gap-5 p-6">
                <Text className="text-center text-4xl">⚠️</Text>
                <Text className="text-center text-2xl font-bold text-foreground">
                  Opa! Já tem um local aqui
                </Text>
                <View className="gap-1 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                  <Text className="text-center text-lg font-bold text-amber-900">
                    {formatarNomeLocal(confirmarPerto.nome)}
                  </Text>
                  {semMatchCoords && confirmarPerto.lat != null && confirmarPerto.lng != null && (
                    <Text className="text-center text-base text-amber-800">
                      fica a{" "}
                      {formatarDistancia(
                        haversineMetros(
                          semMatchCoords.lat,
                          semMatchCoords.lng,
                          confirmarPerto.lat,
                          confirmarPerto.lng,
                        ),
                      )}{" "}
                      de você
                    </Text>
                  )}
                </View>
                <Text className="text-center text-base text-muted-foreground">
                  Provavelmente é esse mesmo. Tem certeza que quer criar um local
                  NOVO em vez de usar ele?
                </Text>
              </View>
            ) : (
            // Nome PRIMEIRO, no topo: com a lista em cima, o teclado (autoFocus)
            // cobria o campo. Sugestões embaixo, e a tela rola.
            <ScrollView
              className="flex-1"
              contentContainerClassName="gap-4 p-5"
              keyboardShouldPersistTaps="handled"
            >
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

              {matchesProximos.length > 0 && (
                <View className="gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <Text className="text-sm font-bold text-amber-900">
                    ⚠️ Talvez já exista — confira antes de criar
                  </Text>
                  {matchesProximos.slice(0, 3).map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => escolherMatch(m)}
                      className="flex-row items-center justify-between rounded-lg border border-amber-300 bg-background px-3 py-2.5"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                          {formatarNomeLocal(m.nome)}
                        </Text>
                        {m.lat != null && m.lng != null && (
                          <Text className="text-xs text-muted-foreground">
                            a {formatarDistancia(haversineMetros(semMatchCoords!.lat, semMatchCoords!.lng, m.lat, m.lng))} daqui
                          </Text>
                        )}
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
            </ScrollView>
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
                  onPress={() => criarLocalNovo()}
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
                <Button className="flex-1" onPress={salvarNomeNovo}>
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
    </View>
  );
}
