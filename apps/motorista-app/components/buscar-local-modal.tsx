import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { MapPin, Search, X } from "lucide-react-native";
import { formatarNomeLocal } from "@ronan/shared-types";
import { useCatalogos, type Local } from "@/lib/queries";
import { enderecoResumido, LinhaEndereco } from "@/components/local-info";
import type { TelemetriaViagem } from "@/lib/telemetria-viagem";

/**
 * Busca de local de descarga por NOME sobre o catálogo já cacheado localmente
 * (todos os locais ativos). Liberado só pra quem tem o flag podeVerTodosLocais —
 * pra criar viagem pra qualquer local sem estar fisicamente nele (ex: dev testando).
 *
 * Lista virtualizada (FlatList) aguenta milhares de locais; busca acento-insensível
 * por nome/cidade. Sem paginação: o filtro é em memória, instantâneo e offline.
 */

// Deburr manual pros acentos comuns do PT — evita depender de String.normalize
// (suporte irregular no Hermes) e cobre o alfabeto que aparece em nomes de local.
function semAcento(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áàâãä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôõö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/ç/g, "c")
    .replace(/ñ/g, "n");
}

export function BuscarLocalModal({
  visible,
  onClose,
  onSelecionar,
  telemetria,
}: {
  visible: boolean;
  onClose: () => void;
  onSelecionar: (local: Local) => void;
  /** Telemetria opt-in: registra o texto buscado + nº de resultados. */
  telemetria?: TelemetriaViagem;
}) {
  const [q, setQ] = useState("");
  const catalogos = useCatalogos();

  const locais = useMemo(() => {
    // Só descarga (DESCARGA/AMBOS); já vem ordenado por nome do backend.
    const todos = (catalogos.data?.locais ?? []).filter(
      (l) => l.tipo === "DESCARGA" || l.tipo === "AMBOS",
    );
    const termo = semAcento(q.trim());
    if (!termo) return todos;
    return todos.filter(
      (l) =>
        semAcento(l.nome).includes(termo) || semAcento(l.cidade ?? "").includes(termo),
    );
  }, [catalogos.data, q]);

  function fechar() {
    if (telemetria && q.trim()) {
      const total = (catalogos.data?.locais ?? []).filter(
        (l) => l.tipo === "DESCARGA" || l.tipo === "AMBOS",
      ).length;
      telemetria.busca("descarga_nome", q.trim(), locais.length, total);
    }
    setQ("");
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={fechar}>
      {/* SafeAreaProvider dentro do Modal: no iOS o inset do topo não propaga pro
          conteúdo do Modal sem isso, e o header ficava sob a barra de status/notch. */}
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
          <Text className="flex-1 text-lg font-bold text-foreground">Buscar local</Text>
          <Pressable
            onPress={fechar}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
          >
            <X size={24} color="#0f172a" />
          </Pressable>
        </View>

        <View className="px-4 py-3">
          <View className="relative">
            <View className="absolute left-3 top-1/2 z-10 -translate-y-1/2">
              <Search size={20} color="#64748b" />
            </View>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Digite o nome do local"
              placeholderTextColor="#94a3b8"
              autoFocus
              autoCorrect={false}
              className="h-14 rounded-xl border-2 border-border bg-background pl-11 pr-3 text-base text-foreground"
            />
          </View>
        </View>

        <FlatList
          data={locais}
          keyExtractor={(l) => l.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <Text className="px-4 py-10 text-center text-base text-muted-foreground">
              {q.trim() ? "Nenhum local com esse nome." : "Nenhum local cadastrado."}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onSelecionar(item);
                fechar();
              }}
              className="flex-row items-start gap-3 border-b border-border px-4 py-4 active:bg-muted"
            >
              <View className="mt-0.5">
                <MapPin size={18} color="#2563eb" />
              </View>
              <View className="flex-1">
                <Text
                  className="text-base font-semibold text-foreground"
                  numberOfLines={2}
                >
                  {formatarNomeLocal(item.nome)}
                </Text>
                <LinhaEndereco
                  endereco={enderecoResumido(item)}
                  cidade={item.cidade}
                  uf={item.uf}
                />
              </View>
            </Pressable>
          )}
        />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
