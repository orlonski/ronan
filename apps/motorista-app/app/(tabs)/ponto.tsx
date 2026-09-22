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
  MapPin,
  PenLine,
  TriangleAlert,
} from "lucide-react-native";
import { usePendingPonto } from "@/hooks/use-pending-ponto";
import { useCatalogoPonto, usePontoHoje } from "@/lib/queries";
import { enqueuePonto } from "@/lib/sync";
import { useConnectivity } from "@/lib/connectivity";
import { hojeISO } from "@/lib/datetime";
import { usePermite } from "@/lib/acessos-app";

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
  const { data: catalogo } = useCatalogoPonto();
  const verEspelho = usePermite("app.ponto.espelho");
  // `?? false`: sem catálogo em mãos, não coleta. Ver CatalogoPonto.
  const capturaLocalizacao = catalogo?.capturaLocalizacao ?? false;
  const [dia, setDia] = useState(hojeISO);
  // 10s, e não 30: este intervalo é o único que vira o `dia` da tela. Esticar
  // pra economizar render triplicaria a janela em que a lista e a query ainda
  // olham ontem.
  useEffect(() => {
    const t = setInterval(() => {
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
    /**
     * ⚠️ O dia do PAYLOAD sai de `hojeISO()` no instante do toque, nunca do
     * estado da tela.
     *
     * O `dia` do cliente é gravado cru e vira a chave do registro na
     * apuração. Bater 00:00:20 com o estado ainda em ontem arquivaria a
     * batida no dia ANTERIOR, com `marcadoEm` de hoje — e a janela seria do
     * tamanho do intervalo do tick. Aqui ela é zero.
     */
    const diaDoToque = hojeISO();
    try {
      // GPS é EVIDÊNCIA, nunca porteiro: usa a permissão que já existe, nunca
      // pede na hora, e desiste em 3s. Sem `race`, um GPS pendurado deixaria o
      // botão desabilitado e a pessoa sem conseguir bater.
      let coords: { latitude: number; longitude: number; precisao?: number } | undefined;
      try {
        // O interruptor é aqui, e não no servidor: empresa que desligou a
        // coleta não pode ter a coordenada saindo do aparelho nem entrando na
        // fila do outbox. "Não guardamos" ≠ "não coletamos".
        const { status } = capturaLocalizacao
          ? await Location.getForegroundPermissionsAsync()
          : { status: "denied" as const };
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

      await enqueuePonto({ marcadoEm, dia: diaDoToque, ...coords });
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
        {/* ⚠️ SEM RELÓGIO. Tinha um de 60pt aqui mostrando a hora atual — que
            a barra de status do sistema já mostra, dois centímetros acima. Era
            o espaço mais nobre da tela gasto repetindo o SO.
            
            E trocar o conteúdo dele pela "última batida" só mudaria de quem a
            repetição é: a hora reaparece na lista logo abaixo e o estado
            reaparece na tarja. A hora da última batida foi pra DENTRO da
            tarja, que já é o lugar do estado.
            
            O que fica é o que o sistema não sabe: de qual empresa é este
            ponto, e que dia o app vai gravar. A data é a afirmação mais forte
            do topo de propósito — data errada já foi bug aqui, com quem vira
            a noite. */}
        <View className="px-5 pb-3 pt-2" style={online ? undefined : { paddingTop: 44 }}>
          <Text numberOfLines={1} className="text-sm font-medium text-white/70">
            {data?.funcionario
              ? `${data.funcionario.cargo ?? "Registrado"}${data.funcionario.empresa ? ` · ${data.funcionario.empresa}` : ""}`
              : "Meu ponto"}
          </Text>
          <Text numberOfLines={1} className="text-xl font-semibold text-white">
            {dataPorExtenso(dia)}
          </Text>
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
          ultima={batidas.length > 0 ? batidas[batidas.length - 1]!.hora : null}
          // Só afirma "nenhuma batida" quando HOUVE resposta pra este dia.
          // Sem isso, os 100-400ms de leitura do cache viram o app dizendo,
          // em toda abertura, que a pessoa não bateu.
          carregando={data == null && naFila.length === 0}
          onResolver={() => router.push("/pendentes")}
        />

        {verEspelho && (
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
        )}

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

        {/* Mesmo corpo do cartão do espelho, de propósito. Isto aqui era um
            ícone de 18 com um texto do lado, sem borda e sem fundo — do lado
            de um cartão de verdade, lia como legenda, não como coisa que se
            toca. Num app de dedão grosso, alvo sem corpo não existe. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pedir correção de uma batida de hoje"
          onPress={() => router.push(`/corrigir-ponto?dia=${dia}`)}
          className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card px-4 active:opacity-75"
          style={{ minHeight: 72 }}
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
            <PenLine size={24} color={COR_BRAND} />
          </View>
          <View className="flex-1">
            {/* A pergunta é o título porque é o que a pessoa reconhece: ela
                não procura "correção", ela lembra que bateu errado. */}
            <Text className="text-base font-semibold text-foreground">
              Bateu errado ou esqueceu?
            </Text>
            <Text className="text-sm text-muted-foreground">peça a correção de hoje</Text>
          </View>
          <ChevronRight size={20} color="#64748b" />
        </Pressable>

        {/* Fica na tela DIÁRIA, palavra por palavra. É o único argumento
            diário, pra quem desconfia de ponto eletrônico, de que a empresa
            não mexe no dado — e é o que sustenta a fricção de 1,2s. */}
        <Text className="text-center text-xs text-muted-foreground">
          As batidas são suas e ninguém pode apagá-las — nem a empresa, nem nós. O que muda a
          conta é a correção, e ela fica registrada com autor e motivo.
        </Text>

        {capturaLocalizacao && <AvisoLocalizacao texto={catalogo?.empresa?.avisoLgpdTexto} />}
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
  ultima,
  carregando,
  onResolver,
}: {
  erroLocal: string | null;
  falhou: { dia: string; hoje: string } | null;
  naFila: number;
  batidas: number;
  ultima: string | null;
  carregando: boolean;
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
            ? `Sua batida${ultima ? ` das ${ultima}` : ""} não chegou. Toque para resolver.`
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
            ? `1 batida guardada aqui${ultima ? `, das ${ultima}` : ""}. Sobe sozinha quando o sinal voltar.`
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
          {ultima
            ? `Tudo certo — sua última foi ${ultima}.`
            : "Tudo certo — suas batidas chegaram no escritório."}
        </Text>
      </View>
    );
  }
  return (
    <View className={`${base} border-border bg-muted`} style={estilo}>
      <Clock size={22} color="#64748b" />
      <Text className="flex-1 text-sm text-foreground">
        {carregando
          ? "Carregando suas batidas…"
          : "Bata quando começar, na saída e na volta do almoço, e no fim."}
      </Text>
    </View>
  );
}

/* `relogio()` saiu junto com o relógio do cabeçalho. */

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

/**
 * O aviso de que a batida leva a localização junto.
 *
 * ⚠️ Só aparece quando a empresa de fato coleta, e some quando ela desliga.
 * Aviso que fica na tela independente do que o sistema faz vira paisagem, e
 * paisagem não informa ninguém.
 *
 * A linha curta é sempre visível porque é a que precisa ser lida; o texto
 * completo (configurável pela empresa em Regras de ponto) abre no toque.
 * Empilhar dois parágrafos jurídicos embaixo do botão faria as duas coisas
 * não serem lidas.
 *
 * Inline, e não `Modal`: nesta tela já existe overlay de confirmação, e
 * `Modal` sobre `Modal` no Android é o defeito que já custou caro aqui.
 */
function AvisoLocalizacao({ texto }: { texto?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sobre a localização das suas batidas"
      accessibilityState={{ expanded: aberto }}
      onPress={() => setAberto((v) => !v)}
      className="flex-row items-start gap-2 rounded-2xl bg-muted px-4 py-3 active:opacity-75"
    >
      <MapPin size={16} color="#64748b" style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text className="text-xs text-muted-foreground">
          Cada batida guarda também onde você estava.{" "}
          <Text className="font-semibold text-brand">{aberto ? "esconder" : "entenda"}</Text>
        </Text>
        {aberto && (
          <Text className="mt-2 text-xs leading-5 text-muted-foreground">
            {texto?.trim() ||
              "Ao bater o ponto, o aplicativo registra a data, a hora e — quando o aparelho informa — a sua localização naquele instante. A localização serve só como evidência do registro e é apagada depois do prazo configurado pela empresa."}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
