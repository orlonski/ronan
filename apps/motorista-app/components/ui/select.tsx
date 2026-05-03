import { useState } from "react";
import { ChevronDown, Search, X } from "lucide-react-native";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  sublabel?: string;
};

export function Select({
  value,
  onChange,
  options,
  placeholder = "Selecione",
  searchable,
  disabled,
  className,
  emptyMessage,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value);

  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.sublabel?.toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  function fechar() {
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          "h-14 flex-row items-center justify-between rounded-xl border-2 border-border bg-background px-4",
          disabled && "opacity-50",
          className,
        )}
      >
        <Text
          className={cn(
            "flex-1 text-[17px] font-medium",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={22} color="#64748b" />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={fechar}
        statusBarTranslucent
      >
        {/* Sheet full-screen — search fica fixa no topo, lista scroll abaixo,
            teclado pode aparecer sem cobrir conteudo importante. */}
        <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
          {/* Header brand com search ou só título + X */}
          <View className="bg-brand px-4 pb-3 pt-14">
            <View className="mb-3 flex-row items-center gap-3">
              <Pressable
                onPress={fechar}
                className="h-10 w-10 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
              >
                <X size={20} color="white" />
              </Pressable>
              <Text className="flex-1 text-xl font-bold text-white" numberOfLines={1}>
                {title ?? placeholder}
              </Text>
            </View>

            {searchable && (
              <View className="flex-row items-center gap-2 rounded-xl bg-white px-3">
                <Search size={18} color="#64748b" />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar..."
                  placeholderTextColor="#94a3b8"
                  className="h-12 flex-1 text-base font-medium text-foreground"
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {query.length > 0 && (
                  <Pressable
                    onPress={() => setQuery("")}
                    className="h-8 w-8 items-center justify-center"
                  >
                    <X size={18} color="#64748b" />
                  </Pressable>
                )}
              </View>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: 32 }}
            ListEmptyComponent={
              <Text className="py-12 text-center text-base text-muted-foreground">
                {emptyMessage ?? "Nada encontrado"}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  fechar();
                }}
                className={cn(
                  "border-b border-border px-4 py-4 active:bg-muted",
                  item.value === value && "bg-muted",
                )}
              >
                <Text className="text-lg font-semibold text-foreground">
                  {item.label}
                </Text>
                {item.sublabel && (
                  <Text className="mt-0.5 text-sm text-muted-foreground">
                    {item.sublabel}
                  </Text>
                )}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
