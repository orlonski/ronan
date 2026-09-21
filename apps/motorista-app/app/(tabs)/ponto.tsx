import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  CloudOff,
  PenLine,
  TriangleAlert,
} from "lucide-react-native";
import { usePendingPonto } from "@/hooks/use-pending-ponto";
import { usePontoHoje } from "@/lib/queries";
import { enqueuePonto } from "@/lib/sync";
import { useConnectivity } from "@/lib/connectivity";
import { hojeISO } from "@/lib/datetime";

/**
 * A ABA DO PONTO.
 *
 * ⚠️ O desenho tem UMA decisão que manda em tudo: cabeçalho e botão são uma
 * região FIXA, e só o que está abaixo rola.
 *
 * Não é estética. Com o botão dentro do ScrollView, qualquer tremida do dedo
 * durante o 1,2s de hold fazia a rolagem roubar o toque e CANCELAR o registro
 * sem avisar — dentro do caminhão isso acontecia. Tirar do scroll conserta
 * isso; em troca, a rolagem deixa de ser o guarda contra toque acidental, e
 * por isso o hold passou a cancelar por DESLOCAMENTO do dedo (ver
 * `onTouchMove`). Um defeito trocado por outro não seria conserto.
 *
 * ⚠️ O que não muda nunca: grava UM INSTANTE, sem rótulo e sem escolha; o
 * registro não é bloqueado por sinal, escala, horário nem mensalidade; e a
 * fricção de 1,2s existe porque batida errada não se apaga.
 */

const SEGURAR_MS = 1200;
/** Acima disto o dedo está rolando a tela, não segurando o botão. */
const TOLERANCIA_ARRASTO = 20;
/** O GPS é evidência: passou disto, registra sem coordenada. */
const TIMEOUT_GPS_MS = 3000;

const COR_OK = "#1DA54F";
const COR_AVISO = "#B4501A";
const COR_ERRO = "#EB1414";
const COR_BRAND = "#13316b";

export default function PontoTab() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const online = useConnectivity();

  /**
   * ⚠️ `dia` é ESTADO, não constante de render. A aba fica montada; quem vira
   * a noite abriria às 23h e bateria 00:10 com a data de ONTEM no payload, na
   * query e na lista. Turno da noite é o público desta tela.
   */
  const [dia, setDia] = useState(hojeISO);
  const [agora, setAgora] = useState(relogio);
  useEffect(() => {
    const t = setInterval(() => {
      setAgora(relogio());
      setDia((d) => {
        const hoje = hojeISO();
        return hoje === d ? d : hoje;
      });
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  const { data, refetch } = usePontoHoje(dia);
  const [batendo, setBatendo] = useState(false);
  const [segurando, setSegurando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const progresso = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toqueEm = useRef<{ x: number; y: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const naFila = usePendingPonto();

  /**
   * União por `clientId`, nunca por horário.
   *
   * Dois motivos. O item que já subiu leva alguns instantes pra sair da fila
   * local: sem a união a lista PISCA vazia bem na hora em que o sinal volta —
   * e a pessoa lê "você não bateu nada hoje". E deduplicar por HH:MM apagaria
   * da tela a segunda batida do mesmo minuto, que é justamente o produto de
   * um hold duplo — quem poderia pedir a correção é quem não ficaria sabendo.
   */
  const jaSubiu = new Set((data?.marcacoes ?? []).map((m) => m.clientId));
  const doDia = naFila.filter((i) => i.payload.dia === dia && !jaSubiu.has(i.payload.clientId));

  /**
   * A falha olha a fila INTEIRA, não só a de hoje. Bateu no fim do turno sem
   * sinal e as tentativas esgotaram de madrugada: o item vira de ontem, e com
   * o filtro por dia ele não aparecia em lugar nenhum desta tela. O que some
   * de vista é prova de jornada.
   */
  const falhou = naFila.find((i) => i.status === "error");

  const batidas = [
    ...(data?.marcacoes ?? []).map((m) => ({
      chave: m.clientId,
      hora: horaBR(m.marcadoEm),
      estado: "enviada" as const,
    })),
    ...doDia.map((i) => ({
      chave: i.payload.clientId,
      hora: horaBR(i.payload.marcadoEm),
      estado: i.status === "error" ? ("erro" as const) : ("fila" as const),
    })),
  ].sort((a, b) => a.hora.localeCompare(b.hora));

  function cancelarHold() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    toqueEm.current = null;
    setSegurando(false);
    Animated.timing(progresso, { toValue: 0, duration: 140, useNativeDriver: false }).start();
  }

  function iniciarHold(x: number, y: number) {
    if (batendo) return;
    toqueEm.current = { x, y };
    setErroLocal(null);
    setSegurando(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    progresso.setValue(0);
    Animated.timing(progresso, {
      toValue: 1,
      duration: SEGURAR_MS,
      easing: Easing.linear,
      // `false` porque o que anima é a LARGURA: com driver nativo a barra não
      // mexe, e a pessoa fica segurando um botão que não responde.
      useNativeDriver: false,
    }).start();
    timer.current = setTimeout(() => {
      setSegurando(false);
      void bater();
    }, SEGURAR_MS);
  }

  // Sair do app com o dedo apoiado não pode disparar uma batida fantasma.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") cancelarHold();
    });
    return () => sub.remove();
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function bater() {
    setBatendo(true);
    const marcadoEm = new Date().toISOString();
    try {
      // GPS é EVIDÊNCIA, nunca porteiro: usa a permissão que já existe, nunca
      // pede na hora, e desiste em 3s. Sem `race`, um GPS pendurado deixaria o
      // botão desabilitado e a pessoa sem conseguir bater.
      let coords: { latitude: number; longitude: number; precisao?: number } | undefined;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_GPS_MS)),
          ]);
          if (pos) {
            coords = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              precisao: pos.coords.accuracy ?? undefined,
            };
          }
        }
      } catch {
        /* sem GPS o registro vale do mesmo jeito */
      }

      await enqueuePonto({ marcadoEm, dia, ...coords });
      // ⚠️ O háptico de sucesso vem DEPOIS da gravação. Antes, ele saía junto
      // com o disparo do timer: se o armazenamento local falhasse, a pessoa
      // sentia o "pronto" e não existia batida em lugar nenhum.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["ponto-hoje"] });
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      // Estado que NÃO some sozinho: é a única falha que não deixa rastro em
      // lugar nenhum, nem na fila.
      setErroLocal("Não consegui gravar a batida. Segure o botão de novo.");
    } finally {
      setBatendo(false);
      progresso.setValue(0);
    }
  }

  const titulo = batendo ? "Registrando…" : segurando ? "Continue segurando…" : "Segure para registrar";
  const sub = batendo
    ? "guardando a batida"
    : segurando
      ? "solte agora e não registra"
      : "segure 1 segundo";

  return (
    <View className="flex-1 bg-background">
      {/* ───────── REGIÃO FIXA ───────── */}
      <SafeAreaView edges={["top"]} className="bg-brand">
        {/* O banner global de "sem internet" é absoluto e cobriria a metade de
            cima do relógio — justamente quando a hora mais precisa ser lida. */}
        <View className="px-5 pb-3 pt-2" style={online ? undefined : { paddingTop: 44 }}>
          <View className="flex-row items-end justify-between">
            <Text
              accessibilityLabel={`Agora são ${agora}`}
              accessibilityLiveRegion="none"
              maxFontSizeMultiplier={1.15}
              className="text-6xl font-bold tracking-tight text-white"
            >
              {agora}
            </Text>
            <View className="ml-3 flex-1 items-end">
              <Text numberOfLines={1} className="text-xs font-medium text-white/70">
                {data?.funcionario
                  ? `${data.funcionario.cargo ?? "Registrado"}${data.funcionario.empresa ? ` · ${data.funcionario.empresa}` : ""}`
                  : "Carregando…"}
              </Text>
              <Text numberOfLines={1} className="text-sm text-white/85">
                {dataPorExtenso(dia)}
              </Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* O botão NÃO é o mesmo azul colado no cabeçalho: no sol, dois blocos
          navy grudados deixam de ler como botão e viram continuação da faixa. */}
      <View className="bg-background px-4 pb-4 pt-5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Segure para registrar o ponto"
          accessibilityHint="Mantenha o dedo no botão por um segundo"
          disabled={batendo}
          onTouchStart={(e) => iniciarHold(e.nativeEvent.pageX, e.nativeEvent.pageY)}
          onTouchMove={(e) => {
            const p = toqueEm.current;
            if (!p) return;
            const dx = Math.abs(e.nativeEvent.pageX - p.x);
            const dy = Math.abs(e.nativeEvent.pageY - p.y);
            // Sem o ScrollView por baixo, é isto que impede o dedo apoiado
            // (ou arrastando) de virar batida.
            if (dx > TOLERANCIA_ARRASTO || dy > TOLERANCIA_ARRASTO) cancelarHold();
          }}
          onTouchEnd={cancelarHold}
          onTouchCancel={cancelarHold}
          className="overflow-hidden rounded-3xl border-2 border-white/25 bg-brand"
          style={{ height: 140 }}
        >
          <Animated.View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              backgroundColor: "rgba(255,255,255,0.40)",
              width: progresso.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
            }}
          />
          <View className="flex-1 items-center justify-center px-4">
            <Text
              maxFontSizeMultiplier={1.3}
              className="text-center text-2xl font-bold text-brand-foreground"
            >
              {titulo}
            </Text>
            <Text className="mt-1 text-base text-brand-foreground/80">{sub}</Text>
          </View>
        </Pressable>
      </View>

      {/* ───────── MIOLO (rola) ───────── */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 28 + insets.bottom,
          gap: 12,
        }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => {
              setAtualizando(true);
              void refetch().finally(() => setAtualizando(false));
            }}
          />
        }
      >
        <Tarja
          erroLocal={erroLocal}
          falhou={falhou ? { dia: falhou.payload.dia, hoje: dia } : null}
          naFila={doDia.length}
          batidas={batidas.length}
          onResolver={() => router.push("/pendentes")}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Meu espelho do mês"
          onPress={() => router.push("/meu-espelho")}
          className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card px-4 active:opacity-75"
          style={{ minHeight: 72 }}
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
            <CalendarDays size={24} color={COR_BRAND} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">Meu espelho do mês</Text>
            <Text className="text-sm text-muted-foreground">horas, dias e saldo</Text>
          </View>
          <ChevronRight size={20} color="#64748b" />
        </Pressable>

        <View className="flex-row items-baseline justify-between">
          <Text className="text-base font-bold text-foreground">Hoje</Text>
          <Text className="text-sm text-muted-foreground">
            {batidas.length === 0
              ? "nenhuma batida"
              : batidas.length === 1
                ? "1 batida"
                : `${batidas.length} batidas`}
          </Text>
        </View>

        {batidas.length === 0 ? (
          <Text className="text-base text-muted-foreground">
            Sua primeira batida de hoje aparece aqui.
          </Text>
        ) : (
          <View className="gap-2">
            {batidas.map((b) => (
              <View
                key={b.chave}
                className={`flex-row items-center justify-between rounded-2xl border-2 px-4 py-3 ${
                  b.estado === "enviada"
                    ? "border-success/40 bg-success/5"
                    : b.estado === "erro"
                      ? "border-destructive/50 bg-destructive/5"
                      : "border-warning/60 bg-warning/10"
                }`}
              >
                <Text className="text-2xl font-bold text-foreground">{b.hora}</Text>
                {b.estado === "enviada" ? (
                  <Check size={22} color={COR_OK} strokeWidth={3} />
                ) : b.estado === "erro" ? (
                  <TriangleAlert size={22} color={COR_ERRO} />
                ) : (
                  <CloudOff size={22} color={COR_AVISO} />
                )}
              </View>
            ))}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/corrigir-ponto?dia=${dia}`)}
          className="flex-row items-center gap-2 active:opacity-70"
          style={{ minHeight: 48 }}
        >
          <PenLine size={18} color={COR_BRAND} />
          <Text className="text-base font-semibold text-brand">Bateu errado hoje? Peça correção</Text>
        </Pressable>

        {/* Fica na tela DIÁRIA, palavra por palavra. É o único argumento
            diário, pra quem desconfia de ponto eletrônico, de que a empresa
            não mexe no dado — e é o que sustenta a fricção de 1,2s. */}
        <Text className="text-center text-xs text-muted-foreground">
          As batidas são suas e ninguém pode apagá-las — nem a empresa, nem nós. O que muda a
          conta é a correção, e ela fica registrada com autor e motivo.
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * A tarja de estado. Altura MÍNIMA fixa, não altura travada: com a fonte
 * grande do sistema o texto de duas linhas não cabe em 56 e seria cortado.
 * O que ela não pode é sumir — a tela pulando de lugar entre um estado e
 * outro faz errar o alvo de quem bate no automático.
 */
function Tarja({
  erroLocal,
  falhou,
  naFila,
  batidas,
  onResolver,
}: {
  erroLocal: string | null;
  falhou: { dia: string; hoje: string } | null;
  naFila: number;
  batidas: number;
  onResolver: () => void;
}) {
  const base = "flex-row items-center gap-3 rounded-2xl border-2 px-4 py-3";
  const estilo = { minHeight: 56 };

  if (erroLocal) {
    return (
      <View className={`${base} border-destructive/50 bg-destructive/5`} style={estilo}>
        <TriangleAlert size={22} color={COR_ERRO} />
        <Text className="flex-1 text-sm font-medium text-foreground">{erroLocal}</Text>
      </View>
    );
  }
  if (falhou) {
    const doDiaAtual = falhou.dia === falhou.hoje;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Abre a lista de pendentes"
        onPress={onResolver}
        className={`${base} border-destructive/50 bg-destructive/5 active:opacity-75`}
        style={estilo}
      >
        <TriangleAlert size={22} color={COR_ERRO} />
        <Text className="flex-1 text-sm font-medium text-foreground">
          {doDiaAtual
            ? "Uma batida não chegou. Toque para resolver."
            : `Uma batida do dia ${falhou.dia.slice(-2)} não chegou. Toque para resolver.`}
        </Text>
        <ChevronRight size={20} color="#64748b" />
      </Pressable>
    );
  }
  if (naFila > 0) {
    return (
      <View className={`${base} border-warning/60 bg-warning/10`} style={estilo}>
        <CloudOff size={22} color={COR_AVISO} />
        <Text className="flex-1 text-sm text-foreground">
          {naFila === 1
            ? "1 batida guardada aqui. Sobe sozinha quando o sinal voltar."
            : `${naFila} batidas guardadas aqui. Sobem sozinhas quando o sinal voltar.`}
        </Text>
      </View>
    );
  }
  if (batidas > 0) {
    return (
      <View className={`${base} border-success/50 bg-success/10`} style={estilo}>
        <Check size={22} color={COR_OK} strokeWidth={3} />
        <Text className="flex-1 text-sm text-foreground">
          Tudo certo — suas batidas chegaram no escritório.
        </Text>
      </View>
    );
  }
  return (
    <View className={`${base} border-border bg-muted`} style={estilo}>
      <Clock size={22} color="#64748b" />
      <Text className="flex-1 text-sm text-foreground">
        Bata quando começar, na saída e na volta do almoço, e no fim.
      </Text>
    </View>
  );
}

/** Hora de Brasília, não a do fuso que o aparelho acha que tem. */
function relogio(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function horaBR(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function dataPorExtenso(ymd: string): string {
  const [a, m, d] = ymd.split("-").map(Number);
  const semana = DIAS[new Date(Date.UTC(a!, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
  return `${semana}, ${d} de ${MESES[(m ?? 1) - 1]}`;
}
