import { useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  BellOff,
  Clock,
  MoreVertical,
  RefreshCw,
  Send,
  TriangleAlert,
  X,
} from "lucide-react-native";
import {
  MAX_TEXTO_MENSAGEM,
  MOTIVO_DENUNCIA_LABEL,
  MOTIVOS_DENUNCIA,
  type MensagemChatItem,
  type MotivoDenuncia,
} from "@ronan/shared-types";
import { showAlert, showConfirm } from "@/lib/alert";
import { API_URL } from "@/lib/api-url";
import { loadTokens } from "@/lib/auth";
import { fmtDataHoraCurta } from "@/lib/datetime";
import { humanizeApiError } from "@/lib/api";
import type { PendingMensagemChat } from "@/db/database";
import {
  useApagarMensagem,
  useBloquear,
  useDenunciar,
  useDescartarMensagem,
  useEnviarMensagem,
  useMarcarLida,
  useMensagens,
  useNovidadesConversa,
  usePendentesDaConversa,
  useReenviarMensagem,
  useSilenciar,
} from "@/lib/chat";

/**
 * A conversa. Bolhas do motorista à direita, do outro à esquerda.
 *
 * Uma mensagem escrita sem sinal aparece na hora com um relógio e sai sozinha
 * depois (outbox) — o motorista nunca digita duas vezes por causa de túnel.
 * Enquanto esta tela está montada, um poll curto traz o que o outro escreveu;
 * com a tela fechada quem avisa é a push.
 */
export default function ConversaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversaId = id ?? "";

  const q = useMensagens(conversaId);
  const pendentes = usePendentesDaConversa(conversaId);
  const enviar = useEnviarMensagem(conversaId);
  const reenviar = useReenviarMensagem(conversaId);
  const descartar = useDescartarMensagem(conversaId);
  const marcarLida = useMarcarLida();
  const silenciar = useSilenciar(conversaId);
  const denunciar = useDenunciar();
  const bloquear = useBloquear();
  const apagar = useApagarMensagem(conversaId);

  const [texto, setTexto] = useState("");
  // Token pro <Image> das fotos de aviso: o header tem que vir já na primeira
  // request, senão o Fresco (Android) cacheia o 401 e a bolha fica preta.
  const [token, setToken] = useState<string | null>(null);
  // Foto aberta em tela cheia. Overlay na própria tela, não <Modal>: modal de
  // tela cheia briga com o AlertHost e abre confirmação atrás dele.
  const [fotoAberta, setFotoAberta] = useState<string | null>(null);
  const listaRef = useRef<FlatList<Linha>>(null);

  useEffect(() => {
    void loadTokens().then((t) => setToken(t?.accessToken ?? null));
  }, []);

  useNovidadesConversa(conversaId, true);

  const conversa = q.data?.conversa;
  const somenteLeitura = q.data?.somenteLeitura ?? false;

  // Abriu a conversa = leu. Roda uma vez por montagem e quando chega algo novo.
  const totalServidor = q.data?.mensagens.length ?? 0;
  useEffect(() => {
    if (!conversaId || totalServidor === 0) return;
    marcarLida.mutate(conversaId);
    // marcarLida é estável o suficiente; depender dele reentraria em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaId, totalServidor]);

  const linhas = useMemo<Linha[]>(() => {
    const doServidor: Linha[] = (q.data?.mensagens ?? []).map((m) => ({
      tipo: "servidor" as const,
      m,
    }));
    // Pendente que o servidor já confirmou some da fila no próximo drain; até
    // lá, filtrar por clientId evita a bolha duplicada no meio do caminho.
    const confirmados = new Set((q.data?.mensagens ?? []).map((m) => m.clientId));
    const naFila: Linha[] = (pendentes.data ?? [])
      .filter((p) => !confirmados.has(p.clientId))
      .map((p) => ({ tipo: "pendente" as const, p }));
    return [...doServidor, ...naFila];
  }, [q.data?.mensagens, pendentes.data]);

  useEffect(() => {
    if (linhas.length === 0) return;
    const t = setTimeout(() => listaRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [linhas.length]);

  async function mandar() {
    const t = texto.trim();
    if (!t) return;
    setTexto("");
    try {
      await enviar.mutateAsync(t);
    } catch (err) {
      void showAlert({ title: "Não deu pra enviar", message: humanizeApiError(err) });
    }
  }

  async function menuDaConversa() {
    if (!conversa) return;
    const opcoes = [
      { label: conversa.silenciado ? "Voltar a receber aviso" : "Silenciar conversa", value: "silenciar" },
      ...(conversa.outroMotoristaId
        ? [{ label: "Bloquear motorista", value: "bloquear", style: "destructive" as const }]
        : []),
      { label: "Fechar", value: "cancelar", style: "cancel" as const },
    ];
    const escolha = await showAlert({ title: conversa.titulo, buttons: opcoes });
    if (escolha === "silenciar") {
      silenciar.mutate(!conversa.silenciado);
    } else if (escolha === "bloquear" && conversa.outroMotoristaId) {
      const ok = await showConfirm({
        title: `Bloquear ${conversa.titulo}?`,
        message:
          "Vocês param de trocar mensagem e a conversa some da sua lista. Dá pra desbloquear depois.",
        confirmLabel: "Bloquear",
        destructive: true,
      });
      if (!ok) return;
      await bloquear.mutateAsync(conversa.outroMotoristaId);
      router.back();
    }
  }

  async function menuDaMensagem(m: MensagemChatItem) {
    if (m.apagada) return;
    if (m.meu) {
      const ok = await showConfirm({
        title: "Apagar mensagem?",
        message: "Ela some pros dois lados.",
        confirmLabel: "Apagar",
        destructive: true,
      });
      if (ok) apagar.mutate(m.id);
      return;
    }
    const escolha = await showAlert({
      title: m.autorNome,
      buttons: [
        { label: "Denunciar mensagem", value: "denunciar", style: "destructive" },
        { label: "Fechar", value: "cancelar", style: "cancel" },
      ],
    });
    if (escolha !== "denunciar") return;

    const motivo = await showAlert({
      title: "Por que está denunciando?",
      message: "A operação vê só esta mensagem e as anteriores dela — não a conversa toda.",
      buttons: [
        ...MOTIVOS_DENUNCIA.map((mo) => ({
          label: MOTIVO_DENUNCIA_LABEL[mo],
          value: mo,
        })),
        { label: "Cancelar", value: "cancelar", style: "cancel" as const },
      ],
    });
    if (!motivo || motivo === "cancelar") return;
    try {
      await denunciar.mutateAsync({ mensagemId: m.id, motivo: motivo as MotivoDenuncia });
      void showAlert({
        title: "Denúncia enviada",
        message: "A operação vai avaliar. Obrigado por avisar.",
      });
    } catch (err) {
      void showAlert({ title: "Não deu pra denunciar", message: humanizeApiError(err) });
    }
  }

  async function menuDaPendente(p: PendingMensagemChat) {
    const escolha = await showAlert({
      title: "Mensagem não enviada",
      message: p.errorMsg ?? "Aguardando sinal.",
      buttons: [
        { label: "Tentar de novo", value: "tentar" },
        { label: "Apagar", value: "apagar", style: "destructive" },
        { label: "Fechar", value: "cancelar", style: "cancel" },
      ],
    });
    if (escolha === "tentar") reenviar.mutate(p.clientId);
    if (escolha === "apagar") descartar.mutate(p.clientId);
  }

  return (
    // Só `bottom`: quem cobre a status bar é o header azul (pt-14), igual ao
    // ScreenHeader. Com `top` o safe area pintaria essa faixa de branco.
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="flex-row items-center gap-3 bg-brand px-4 pb-3 pt-14">
        <Pressable
          onPress={() => router.back()}
          className="h-11 w-11 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
        >
          <ArrowLeft size={22} color="white" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-white" numberOfLines={1}>
            {conversa?.titulo ?? "Conversa"}
          </Text>
          {conversa?.silenciado ? (
            <View className="mt-0.5 flex-row items-center gap-1">
              <BellOff size={12} color="rgba(255,255,255,0.8)" />
              <Text className="text-xs text-white/80">Silenciada</Text>
            </View>
          ) : null}
        </View>
        {conversa ? (
          <Pressable
            onPress={() => void menuDaConversa()}
            hitSlop={8}
            accessibilityLabel="Opções da conversa"
            className="h-11 w-11 items-center justify-center rounded-full active:bg-white/20"
          >
            <MoreVertical size={20} color="white" />
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView
        // Android com edge-to-edge não redimensiona a janela sozinho: sem
        // "padding" nas DUAS plataformas o teclado cobre o campo de escrever.
        behavior="padding"
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        {q.isLoading && linhas.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList<Linha>
            ref={listaRef}
            data={linhas}
            keyExtractor={(l) => (l.tipo === "servidor" ? l.m.id : l.p.clientId)}
            contentContainerStyle={{ padding: 12, gap: 6 }}
            onContentSizeChange={() => listaRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text className="mt-12 text-center text-base text-muted-foreground">
                {somenteLeitura
                  ? "Nenhum aviso ainda."
                  : "Manda a primeira mensagem."}
              </Text>
            }
            renderItem={({ item }) =>
              item.tipo === "servidor" ? (
                <Bolha
                  m={item.m}
                  token={token}
                  onAbrirFoto={() => setFotoAberta(item.m.id)}
                  onLongPress={() => void menuDaMensagem(item.m)}
                />
              ) : (
                <BolhaPendente p={item.p} onPress={() => void menuDaPendente(item.p)} />
              )
            }
          />
        )}

        {somenteLeitura ? (
          <View className="border-t border-border bg-muted px-4 py-4">
            <Text className="text-center text-sm text-muted-foreground">
              Canal de avisos — só a transportadora escreve aqui.
            </Text>
          </View>
        ) : (
          <View className="flex-row items-end gap-2 border-t border-border bg-background px-3 py-2">
            <TextInput
              value={texto}
              onChangeText={setTexto}
              placeholder="Escrever mensagem…"
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={MAX_TEXTO_MENSAGEM}
              className="max-h-32 min-h-[48px] flex-1 rounded-3xl border border-input bg-white px-4 py-3 text-base text-foreground"
            />
            <Pressable
              onPress={() => void mandar()}
              disabled={texto.trim().length === 0}
              accessibilityLabel="Enviar"
              className={`h-12 w-12 items-center justify-center rounded-full ${
                texto.trim().length === 0 ? "bg-muted" : "bg-primary"
              }`}
            >
              <Send size={20} color={texto.trim().length === 0 ? "#94a3b8" : "white"} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {fotoAberta && token ? (
        <FotoEmTelaCheia
          mensagemId={fotoAberta}
          token={token}
          onFechar={() => setFotoAberta(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

type Linha =
  | { tipo: "servidor"; m: MensagemChatItem }
  | { tipo: "pendente"; p: PendingMensagemChat };

function Bolha({
  m,
  token,
  onAbrirFoto,
  onLongPress,
}: {
  m: MensagemChatItem;
  token: string | null;
  onAbrirFoto: () => void;
  onLongPress: () => void;
}) {
  const meu = m.meu;
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      className={`max-w-[82%] rounded-2xl px-3 py-2 ${
        meu ? "self-end rounded-br-md bg-primary" : "self-start rounded-bl-md bg-muted"
      }`}
    >
      {!meu && m.autor === "MOTORISTA" ? (
        <Text className="mb-0.5 text-xs font-bold text-primary">{m.autorNome}</Text>
      ) : null}
      {m.fotoDisponivel && token ? (
        <Pressable onPress={onAbrirFoto} className="mb-1.5 active:opacity-80">
          <Image
            source={{
              uri: `${API_URL}/m/chat/mensagens/${m.id}/foto`,
              headers: { Authorization: `Bearer ${token}` },
            }}
            style={{ width: 232, height: 232, borderRadius: 12, backgroundColor: "#0f172a" }}
            resizeMode="cover"
          />
        </Pressable>
      ) : null}
      <Text
        className={`text-base ${
          m.apagada
            ? meu
              ? "italic text-primary-foreground/70"
              : "italic text-muted-foreground"
            : meu
              ? "text-primary-foreground"
              : "text-foreground"
        }`}
      >
        {m.texto ?? ""}
      </Text>
      <Text
        className={`mt-0.5 self-end text-[10px] ${
          meu ? "text-primary-foreground/70" : "text-muted-foreground"
        }`}
      >
        {fmtDataHoraCurta(m.criadoEm)}
      </Text>
    </Pressable>
  );
}

/** Foto do aviso aberta em tela cheia — toca em qualquer lugar pra fechar. */
function FotoEmTelaCheia({
  mensagemId,
  token,
  onFechar,
}: {
  mensagemId: string;
  token: string;
  onFechar: () => void;
}) {
  const { width, height } = useWindowDimensions();
  return (
    <View className="absolute inset-0 bg-black" style={{ zIndex: 30 }}>
      <Pressable className="flex-1 items-center justify-center" onPress={onFechar}>
        <Image
          source={{
            uri: `${API_URL}/m/chat/mensagens/${mensagemId}/foto`,
            headers: { Authorization: `Bearer ${token}` },
          }}
          style={{ width, height: height * 0.8 }}
          resizeMode="contain"
        />
      </Pressable>
      <Pressable
        onPress={onFechar}
        accessibilityLabel="Fechar foto"
        className="absolute right-4 top-14 h-11 w-11 items-center justify-center rounded-full bg-white/20 active:bg-white/30"
      >
        <X size={24} color="white" />
      </Pressable>
    </View>
  );
}

/** Bolha ainda no outbox: relógio enquanto espera sinal, aviso quando falhou. */
function BolhaPendente({
  p,
  onPress,
}: {
  p: PendingMensagemChat;
  onPress: () => void;
}) {
  const falhou = p.status === "error";
  return (
    <Pressable
      onPress={onPress}
      className={`max-w-[82%] self-end rounded-2xl rounded-br-md px-3 py-2 ${
        falhou ? "border-2 border-destructive bg-destructive/10" : "bg-primary/60"
      }`}
    >
      <Text className={`text-base ${falhou ? "text-foreground" : "text-primary-foreground"}`}>
        {p.texto}
      </Text>
      <View className="mt-0.5 flex-row items-center justify-end gap-1">
        {falhou ? (
          <>
            <TriangleAlert size={12} color="#dc2626" />
            <Text className="text-[10px] font-semibold text-destructive">
              Não enviou — toque pra tentar
            </Text>
            <RefreshCw size={11} color="#dc2626" />
          </>
        ) : (
          <>
            <Clock size={11} color="rgba(255,255,255,0.85)" />
            <Text className="text-[10px] text-primary-foreground/85">Aguardando sinal</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}
