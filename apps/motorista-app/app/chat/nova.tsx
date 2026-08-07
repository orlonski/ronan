import { useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, Users } from "lucide-react-native";
import type { ContatoChat } from "@ronan/shared-types";
import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen-header";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { useAbrirConversa, useContatos } from "@/lib/chat";

/**
 * Quem está no chat. Só nome e iniciais — telefone não aparece aqui de
 * propósito: motorista é parceiro autônomo, o contato dele não é da conta
 * dos outros.
 */
export default function NovaConversaScreen() {
  const [busca, setBusca] = useState("");
  const q = useContatos(busca.trim());
  const abrir = useAbrirConversa();

  async function tocar(c: ContatoChat) {
    if (c.conversaId) {
      router.replace(`/chat/${c.conversaId}`);
      return;
    }
    try {
      const conversa = await abrir.mutateAsync(c.motoristaId);
      router.replace(`/chat/${conversa.id}`);
    } catch (err) {
      void showAlert({ title: "Não deu pra abrir", message: humanizeApiError(err) });
    }
  }

  const contatos = q.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScreenHeader title="Nova conversa" />

      <View className="border-b border-border bg-background px-4 py-3">
        <View className="flex-row items-center gap-2 rounded-2xl border border-input bg-white px-3">
          <Search size={18} color="#94a3b8" />
          <TextInput
            value={busca}
            onChangeText={setBusca}
            placeholder="Procurar motorista…"
            placeholderTextColor="#94a3b8"
            autoCorrect={false}
            className="h-12 flex-1 text-base text-foreground"
          />
        </View>
      </View>

      {q.isLoading && contatos.length === 0 ? (
        <View className="py-12">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList<ContatoChat>
          data={contatos}
          keyExtractor={(c) => c.motoristaId}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
          ListEmptyComponent={
            <EmptyState
              icon={Users}
              title={busca ? "Ninguém com esse nome" : "Ninguém por aqui ainda"}
              description={
                busca
                  ? "Confere o nome e tenta de novo."
                  : "Assim que os outros motoristas entrarem no chat, eles aparecem aqui."
              }
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void tocar(item)}
              disabled={abrir.isPending}
              className="flex-row items-center gap-3 px-4 py-3 active:bg-muted"
            >
              <View className="h-12 w-12 items-center justify-center rounded-full bg-primary/15">
                <Text className="text-base font-bold text-primary">{item.iniciais}</Text>
              </View>
              <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={1}>
                {item.nome}
              </Text>
              {item.conversaId ? (
                <Text className="text-xs text-muted-foreground">já conversaram</Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
