import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useMe, usePendingStories, useStoriesFeed } from "@/lib/queries";
import { StoryAvatar } from "./story-avatar";

/**
 * Barra de stories no topo da Home (estilo Instagram): 1º item "Seu story" (+)
 * pra postar, depois uma bolinha por autor com stories ativos. Anel laranja =
 * tem story não visto; anel cinza = já viu tudo. Toca → abre o visualizador.
 * Story recém-postado aparece na hora como "Enviando…" (do outbox), sem esperar
 * o upload terminar.
 */
export function StoriesBar() {
  const me = useMe();
  const feed = useStoriesFeed();
  const pendentes = usePendingStories();
  const grupos = feed.data?.grupos ?? [];
  const primeiroNome = me.data?.nome?.split(/\s+/)[0] ?? "Você";

  // Rollout por flag: sem liberação, a barra nem aparece.
  if (!me.data?.podeVerStories) return null;

  const enviando = pendentes[0]; // mostra o mais recente em upload

  return (
    <View className="mb-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 2, gap: 14 }}
      >
        {/* Postar novo story */}
        <Pressable
          onPress={() => router.push("/stories/nova")}
          className="items-center active:opacity-70"
          style={{ width: 72 }}
        >
          <StoryAvatar nome={primeiroNome} ring="none" plus />
          <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
            Seu story
          </Text>
        </Pressable>

        {/* Story em envio (otimista, direto do outbox) */}
        {enviando && (
          <View className="items-center" style={{ width: 72 }}>
            <View>
              <StoryAvatar
                nome={primeiroNome}
                ring="seen"
                fotoUri={enviando.fotoUri}
              />
              <View className="absolute inset-0 items-center justify-center rounded-full bg-black/45">
                <ActivityIndicator color="white" size="small" />
              </View>
            </View>
            <Text
              className={
                enviando.status === "error"
                  ? "mt-1 text-xs text-destructive"
                  : "mt-1 text-xs text-muted-foreground"
              }
              numberOfLines={1}
            >
              {enviando.status === "error" ? "Erro ao enviar" : "Enviando…"}
            </Text>
          </View>
        )}

        {grupos.map((g) => (
          <Pressable
            key={g.autor.id}
            onPress={() => router.push(`/stories/${g.autor.id}`)}
            className="items-center active:opacity-70"
            style={{ width: 72 }}
          >
            <StoryAvatar
              nome={g.autor.nome}
              ring={g.ehMeu ? "seen" : g.temNaoVisto ? "unseen" : "seen"}
            />
            <Text className="mt-1 text-xs text-foreground" numberOfLines={1}>
              {g.ehMeu ? "Seu story" : g.autor.nome.split(/\s+/)[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
