import { useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  BellOff,
  Clock,
  Mic,
  MoreVertical,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react-native";
import {
  MAX_TEXTO_MENSAGEM,
  MOTIVO_DENUNCIA_LABEL,
  MOTIVOS_DENUNCIA,
  type MensagemChatItem,
  type MotivoDenuncia,
} from "@ronan/shared-types";
import { showAlert, showConfirm } from "@/lib/alert";
import { fmtDataHoraCurta } from "@/lib/datetime";
import { humanizeApiError } from "@/lib/api";
import type { PendingAudioChat, PendingMensagemChat } from "@/db/database";
import { BolhaAudio } from "@/components/bolha-audio";
import { fmtDuracao, useGravadorChat } from "@/lib/audio-chat";
import {
  useApagarMensagem,
  useBloquear,
  useDenunciar,
  useDescartarAudio,
  useDescartarMensagem,
  useEnviarAudio,
  useEnviarMensagem,
  useMarcarLida,
  useMensagens,
  useNovidadesConversa,
  usePendentesDaConversa,
  useReenviarAudio,
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
  const enviarAudio = useEnviarAudio(conversaId);
  const reenviarAudio = useReenviarAudio(conversaId);
  const descartarAudio = useDescartarAudio(conversaId);
  const gravador = useGravadorChat();
  const reenviar = useReenviarMensagem(conversaId);
  const descartar = useDescartarMensagem(conversaId);
  const marcarLida = useMarcarLida();
  const silenciar = useSilenciar(conversaId);
  const denunciar = useDenunciar();
  const bloquear = useBloquear();
  const apagar = useApagarMensagem(conversaId);

  const [texto, setTexto] = useState("");
  const listaRef = useRef<FlatList<Linha>>(null);

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
    const naFila: Linha[] = (pendentes.data?.textos ?? [])
      .filter((p) => !confirmados.has(p.clientId))
      .map((p) => ({ tipo: "pendente" as const, p }));
    const audiosNaFila: Linha[] = (pendentes.data?.audios ?? [])
      .filter((a) => !confirmados.has(a.clientId))
      .map((a) => ({ tipo: "audio-pendente" as const, a }));
    return [...doServidor, ...naFila, ...audiosNaFila];
  }, [q.data?.mensagens, pendentes.data]);

  useEffect(() => {
    if (linhas.length === 0) return;
    const t = setTimeout(() => listaRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [linhas.length]);

  // Teto de duração: para e manda sozinho. Sem isso, um dedo esquecido no
  // botão vira um arquivo de 5+ min que não sobe em 4G e custa caro de
  // transcrever — e o motorista só descobriria na hora de enviar.
  useEffect(() => {
    if (gravador.gravando && gravador.atingiuTeto) void pararEEnviar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravador.gravando, gravador.atingiuTeto]);

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

  async function menuDoAudioPendente(a: PendingAudioChat) {
    const escolha = await showAlert({
      title: "Áudio não enviado",
      message: a.errorMsg ?? "Aguardando sinal.",
      buttons: [
        { label: "Tentar de novo", value: "tentar" },
        { label: "Apagar", value: "apagar", style: "destructive" },
        { label: "Fechar", value: "cancelar", style: "cancel" },
      ],
    });
    if (escolha === "tentar") reenviarAudio.mutate(a.clientId);
    if (escolha === "apagar") descartarAudio.mutate(a.clientId);
  }

  async function comecarGravacao() {
    const ok = await gravador.comecar();
    if (ok) return;
    void showAlert({
      title: gravador.erro === "permissao" ? "Sem acesso ao microfone" : "Não deu pra gravar",
      message:
        gravador.erro === "permissao"
          ? "Libere o microfone nos ajustes do celular pra mandar recado de voz."
          : "Tente de novo em alguns segundos.",
    });
  }

  async function pararEEnviar() {
    const g = await gravador.parar();
    if (!g) return;
    await enviarAudio.mutateAsync({
      uri: g.uri,
      mimetype: g.mimetype,
      duracaoSegundos: g.duracaoSegundos,
    });
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
            keyExtractor={(l) =>
              l.tipo === "servidor"
                ? l.m.id
                : l.tipo === "pendente"
                  ? l.p.clientId
                  : l.a.clientId
            }
            contentContainerStyle={{ padding: 12, gap: 6 }}
            onContentSizeChange={() => listaRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text className="mt-12 text-center text-base text-muted-foreground">
                {somenteLeitura
                  ? "Nenhum aviso ainda."
                  : "Manda a primeira mensagem."}
              </Text>
            }
            renderItem={({ item }) => {
              if (item.tipo === "audio-pendente") {
                return (
                  <BolhaPendente
                    rotulo={`🎤 Áudio ${fmtDuracao(item.a.duracaoSegundos)}`}
                    falhou={item.a.status === "error"}
                    onPress={() => void menuDoAudioPendente(item.a)}
                  />
                );
              }
              if (item.tipo === "pendente") {
                return (
                  <BolhaPendente
                    rotulo={item.p.texto}
                    falhou={item.p.status === "error"}
                    onPress={() => void menuDaPendente(item.p)}
                  />
                );
              }
              const m = item.m;
              if (m.tipo === "AUDIO" && !m.apagada) {
                return (
                  <BolhaAudio
                    mensagemId={m.id}
                    meu={m.meu}
                    duracaoSegundos={m.audioSegundos}
                    transcricao={m.transcricao}
                    disponivel={m.audioDisponivel}
                    autorNome={m.autorNome}
                    mostrarAutor={!m.meu && m.autor === "MOTORISTA"}
                    horario={fmtDataHoraCurta(m.criadoEm)}
                    criadoEm={m.criadoEm}
                    onLongPress={() => void menuDaMensagem(m)}
                  />
                );
              }
              return <Bolha m={m} onLongPress={() => void menuDaMensagem(m)} />;
            }}
          />
        )}

        {somenteLeitura ? (
          <View className="border-t border-border bg-muted px-4 py-4">
            <Text className="text-center text-sm text-muted-foreground">
              Canal de avisos — só a Schaba escreve aqui.
            </Text>
          </View>
        ) : (
          gravador.gravando ? (
          // Gravando: a linha inteira vira a barra de gravação. Tap pra
          // começar e tap pra mandar (em vez de segurar) — segurar o dedo é
          // ruim pra quem está no volante, e o alvo aqui é grande de propósito.
          <View className="flex-row items-center gap-3 border-t border-border bg-destructive/10 px-3 py-3">
            <Pressable
              onPress={() => void gravador.cancelar()}
              hitSlop={10}
              accessibilityLabel="Descartar gravação"
              className="h-12 w-12 items-center justify-center rounded-full bg-muted"
            >
              <Trash2 size={20} color="#dc2626" />
            </Pressable>
            <View className="flex-1 flex-row items-center gap-2">
              <View className="h-3 w-3 rounded-full bg-destructive" />
              <Text className="text-base font-bold text-foreground">
                Gravando {fmtDuracao(gravador.segundos)}
              </Text>
            </View>
            <Pressable
              onPress={() => void pararEEnviar()}
              accessibilityLabel="Enviar áudio"
              className="h-12 w-12 items-center justify-center rounded-full bg-primary"
            >
              <Send size={20} color="white" />
            </Pressable>
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
            {texto.trim().length === 0 ? (
              <Pressable
                onPress={() => void comecarGravacao()}
                accessibilityLabel="Gravar áudio"
                className="h-12 w-12 items-center justify-center rounded-full bg-primary"
              >
                <Mic size={22} color="white" />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void mandar()}
                accessibilityLabel="Enviar"
                className="h-12 w-12 items-center justify-center rounded-full bg-primary"
              >
                <Send size={20} color="white" />
              </Pressable>
            )}
          </View>
          )
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Linha =
  | { tipo: "servidor"; m: MensagemChatItem }
  | { tipo: "pendente"; p: PendingMensagemChat }
  | { tipo: "audio-pendente"; a: PendingAudioChat };

function Bolha({
  m,
  onLongPress,
}: {
  m: MensagemChatItem;
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

/** Bolha ainda no outbox: relógio enquanto espera sinal, aviso quando falhou.
 *  Serve texto e áudio — muda só o rótulo. */
function BolhaPendente({
  rotulo,
  falhou,
  onPress,
}: {
  rotulo: string;
  falhou: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`max-w-[82%] self-end rounded-2xl rounded-br-md px-3 py-2 ${
        falhou ? "border-2 border-destructive bg-destructive/10" : "bg-primary/60"
      }`}
    >
      <Text className={`text-base ${falhou ? "text-foreground" : "text-primary-foreground"}`}>
        {rotulo}
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
