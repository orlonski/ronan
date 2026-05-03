import { useState } from "react";
import { ChevronDown, Search } from "lucide-react-native";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
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
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
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

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          "h-12 flex-row items-center justify-between rounded-lg border border-border bg-background px-3",
          disabled && "opacity-50",
          className,
        )}
      >
        <Text
          className={cn(
            "flex-1 text-base",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color="#64748b" />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-black/50">
          <Pressable className="flex-1" onPress={() => setOpen(false)} />
          <SafeAreaView edges={["bottom"]} className="rounded-t-2xl bg-background">
            <View className="px-4 py-3">
              <View className="mb-3 h-1 w-12 self-center rounded-full bg-muted" />
              {searchable && (
                <View className="mb-3 flex-row items-center gap-2 rounded-lg border border-border bg-background px-3">
                  <Search size={16} color="#64748b" />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Buscar..."
                    placeholderTextColor="#94a3b8"
                    className="h-10 flex-1 text-base text-foreground"
                    autoFocus
                  />
                </View>
              )}
              <FlatList
                data={filtered}
                keyExtractor={(o) => o.value}
                style={{ maxHeight: 400 }}
                ListEmptyComponent={
                  <Text className="py-8 text-center text-sm text-muted-foreground">
                    {emptyMessage ?? "Nada encontrado"}
                  </Text>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => {
                      onChange(item.value);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={cn(
                      "border-b border-border px-3 py-3",
                      item.value === value && "bg-muted",
                    )}
                  >
                    <Text className="text-base text-foreground">{item.label}</Text>
                    {item.sublabel && (
                      <Text className="text-xs text-muted-foreground">{item.sublabel}</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
