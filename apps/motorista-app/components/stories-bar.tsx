import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMe, useStoriesFeed } from "@/lib/queries";
import { StoryAvatar } from "./story-avatar";

/**
 * Barra de stories no topo da Home (estilo Instagram): 1º item "Seu story" (+)
 * pra postar, depois uma bolinha por autor com stories ativos. Anel laranja =
 * tem story não visto; anel cinza = já viu tudo. Toca → abre o visualizador.
 */
export function StoriesBar() {
  const me = useMe();
  const feed = useStoriesFeed();
  const grupos = feed.data?.grupos ?? [];
  const primeiroNome = me.data?.nome?.split(/\s+/)[0] ?? "Você";

  // Rollout por flag: sem liberação, a barra nem aparece.
  if (!me.data?.podeVerStories) return null;

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
          <Text
            className="mt-1 text-xs text-muted-foreground"
            numberOfLines={1}
          >
            Seu story
          </Text>
        </Pressable>

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
            <Text
              className="mt-1 text-xs text-foreground"
              numberOfLines={1}
            >
              {g.ehMeu ? "Seu story" : g.autor.nome.split(/\s+/)[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
