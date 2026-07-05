import { useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Eye, Trash2, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { STORY_EMOJIS, type StoryEmoji } from "@ronan/shared-types";
import { StoryAvatar } from "@/components/story-avatar";
import { API_URL } from "@/lib/api-url";
import { loadTokens } from "@/lib/auth";
import { showConfirm } from "@/lib/alert";
import {
  useDeletarStory,
  useMarcarStoryVisto,
  useReagirStory,
  useStoriesFeed,
  useVisualizacoesStory,
} from "@/lib/queries";

const DURACAO_MS = 5000; // tempo de cada story
const TICK_MS = 50;

function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

export default function VisualizadorStoryScreen() {
  const { motoristaId } = useLocalSearchParams<{ motoristaId: string }>();
  const feed = useStoriesFeed();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const grupo = useMemo(
    () => feed.data?.grupos.find((g) => g.autor.id === motoristaId),
    [feed.data, motoristaId],
  );

  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [verVistos, setVerVistos] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const pressStart = useRef(0);

  const marcarVisto = useMarcarStoryVisto();
  const reagir = useReagirStory();
  const deletar = useDeletarStory();

  const stories = grupo?.stories ?? [];
  const atual = stories[idx];
  const ehMeu = grupo?.ehMeu ?? false;

  useEffect(() => {
    void loadTokens().then((t) => setToken(t?.accessToken ?? null));
  }, []);

  // Fecha se o grupo sumiu (feed carregou e não há stories / expirou).
  useEffect(() => {
    if (feed.isSuccess && (!grupo || stories.length === 0)) router.back();
  }, [feed.isSuccess, grupo, stories.length]);

  // Reseta a barra ao trocar de story e marca como visto.
  useEffect(() => {
    setProgress(0);
    if (atual && !ehMeu) marcarVisto.mutate(atual.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual?.id]);

  // Timer da barra de progresso (JS tick — resume trivial ao pausar).
  useEffect(() => {
    if (!atual || pausado || verVistos) return;
    const t = setInterval(() => {
      setProgress((p) => Math.min(1, p + TICK_MS / DURACAO_MS));
    }, TICK_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual?.id, pausado, verVistos]);

  // Ao encher a barra, avança (fora do updater de estado).
  useEffect(() => {
    if (progress >= 1) avancar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  function avancar() {
    if (idx < stories.length - 1) setIdx(idx + 1);
    else router.back();
  }
  function voltar() {
    if (idx > 0) setIdx(idx - 1);
    else setProgress(0);
  }

  function onPressIn() {
    pressStart.current = Date.now();
    setPausado(true);
  }
  function onPressOut(lado: "esq" | "dir") {
    const segurou = Date.now() - pressStart.current > 250;
    setPausado(false);
    if (segurou) return; // foi hold pra pausar, não navega
    if (lado === "dir") avancar();
    else voltar();
  }

  async function onReagir(emoji: StoryEmoji) {
    if (!atual) return;
    const novo = atual.minhaReacao === emoji ? null : emoji;
    reagir.mutate({ storyId: atual.id, emoji: novo });
  }

  async function onDeletar() {
    if (!atual) return;
    const ok = await showConfirm({
      title: "Apagar este story?",
      message: "Ele some pra todos os motoristas.",
      destructive: true,
      confirmLabel: "Apagar",
    });
    if (!ok) return;
    await deletar.mutateAsync(atual.id).catch(() => {});
    router.back();
  }

  if (!grupo || !atual) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <ActivityIndicator color="white" />
      </View>
    );
  }

  const fotoUri = `${API_URL}/m/stories/${atual.id}/foto`;

  return (
    <View className="flex-1 bg-black">
      {/* Foto fullscreen */}
      <Image
        source={{
          uri: fotoUri,
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
        }}
        style={{ flex: 1 }}
        resizeMode="contain"
      />

      {/* Zonas de toque (esq = volta, dir = avança; segurar = pausa) */}
      <View className="absolute inset-0 flex-row">
        <Pressable
          style={{ width: width * 0.32 }}
          onPressIn={onPressIn}
          onPressOut={() => onPressOut("esq")}
        />
        <Pressable
          style={{ flex: 1 }}
          onPressIn={onPressIn}
          onPressOut={() => onPressOut("dir")}
        />
      </View>

      {/* Barras de progresso + header */}
      <View
        pointerEvents="box-none"
        style={{ paddingTop: insets.top + 8 }}
        className="absolute left-0 right-0 top-0 px-3"
      >
        <View className="mb-3 flex-row gap-1">
          {stories.map((s, i) => (
            <View
              key={s.id}
              className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30"
            >
              <View
                className="h-full rounded-full bg-white"
                style={{
                  width: `${i < idx ? 100 : i === idx ? progress * 100 : 0}%`,
                }}
              />
            </View>
          ))}
        </View>

        <View className="flex-row items-center gap-2">
          <StoryAvatar nome={grupo.autor.nome} size={38} ring="none" />
          <View className="flex-1">
            <Text className="text-sm font-bold text-white" numberOfLines={1}>
              {ehMeu ? "Seu story" : grupo.autor.nome}
            </Text>
            <Text className="text-xs text-white/70">
              {tempoRelativo(atual.criadoEm)}
            </Text>
          </View>
          {ehMeu && (
            <Pressable
              onPress={onDeletar}
              className="h-10 w-10 items-center justify-center rounded-full active:bg-white/20"
            >
              <Trash2 size={20} color="white" />
            </Pressable>
          )}
          <Pressable
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-white/20"
          >
            <X size={24} color="white" />
          </Pressable>
        </View>
      </View>

      {/* Legenda + rodapé (reações ou "visto por N") */}
      <View
        pointerEvents="box-none"
        style={{ paddingBottom: insets.bottom + 12 }}
        className="absolute bottom-0 left-0 right-0 px-4"
      >
        {atual.legenda ? (
          <View className="mb-3 self-start rounded-2xl bg-black/55 px-4 py-2">
            <Text className="text-base text-white">{atual.legenda}</Text>
          </View>
        ) : null}

        {ehMeu ? (
          <Pressable
            onPress={() => setVerVistos(true)}
            className="flex-row items-center gap-2 self-start rounded-full bg-black/50 px-4 py-2 active:opacity-70"
          >
            <Eye size={18} color="white" />
            <Text className="text-sm font-semibold text-white">
              Visto por {atual.totalVistos ?? 0}
            </Text>
          </Pressable>
        ) : (
          <View className="flex-row justify-around rounded-full bg-black/45 px-2 py-2">
            {STORY_EMOJIS.map((e) => (
              <Pressable
                key={e}
                onPress={() => onReagir(e)}
                className="px-1 active:opacity-60"
              >
                <Text
                  style={{
                    fontSize: 30,
                    opacity: atual.minhaReacao && atual.minhaReacao !== e ? 0.4 : 1,
                    transform: [{ scale: atual.minhaReacao === e ? 1.25 : 1 }],
                  }}
                >
                  {e}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Sheet "visto por N" (só autor) */}
      {verVistos && (
        <VistosSheet
          storyId={atual.id}
          onClose={() => setVerVistos(false)}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

function VistosSheet({
  storyId,
  onClose,
  bottomInset,
}: {
  storyId: string;
  onClose: () => void;
  bottomInset: number;
}) {
  const q = useVisualizacoesStory(storyId, true);
  return (
    <View className="absolute inset-0 justify-end bg-black/60">
      <Pressable className="flex-1" onPress={onClose} />
      <View
        className="rounded-t-3xl bg-background px-4 pt-4"
        style={{ paddingBottom: bottomInset + 12, maxHeight: "60%" }}
      >
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-bold text-foreground">
            Visto por {q.data?.total ?? 0}
          </Text>
          <Pressable
            onPress={onClose}
            className="h-9 w-9 items-center justify-center rounded-full bg-secondary"
          >
            <X size={18} color="#334155" />
          </Pressable>
        </View>
        {q.isLoading ? (
          <ActivityIndicator className="my-6" />
        ) : (q.data?.visualizadores.length ?? 0) === 0 ? (
          <Text className="py-6 text-center text-muted-foreground">
            Ninguém viu ainda.
          </Text>
        ) : (
          <ScrollView>
            {q.data?.visualizadores.map((v) => (
              <View
                key={v.motoristaId}
                className="flex-row items-center gap-3 py-2"
              >
                <StoryAvatar nome={v.nome} size={40} ring="none" />
                <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                  {v.nome}
                </Text>
                {v.reacao ? (
                  <Text style={{ fontSize: 22 }}>{v.reacao}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
