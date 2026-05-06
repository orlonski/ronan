import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { MapPin, Search } from "lucide-react-native";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { SugestaoEndereco, SugestaoLista } from "@/lib/queries";

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Buscar endereço ou local...",
  coords,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: SugestaoEndereco) => void;
  placeholder?: string;
  /** Posição atual do motorista. Quando passada, prioriza endereços próximos. */
  coords?: { lat: number; lng: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);
  const [sugs, setSugs] = useState<SugestaoLista[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function buscar(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (q.trim().length < 3) {
        setSugs([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (coords) {
          params.set("lat", coords.lat.toString());
          params.set("lng", coords.lng.toString());
        }
        const data = await api.get<SugestaoLista[]>(
          `/geocoding/buscar?${params.toString()}`,
        );
        setSugs(data);
        setOpen(data.length > 0);
      } catch {
        setSugs([]);
      } finally {
        setLoading(false);
      }
    }, 600);
  }

  async function escolher(s: SugestaoLista) {
    setOpen(false);
    setResolvendo(true);
    try {
      const detalhe = await api.get<SugestaoEndereco | null>(
        `/geocoding/place?placeId=${encodeURIComponent(s.placeId)}`,
      );
      if (detalhe) {
        onSelect(detalhe);
        onChange(detalhe.logradouro ?? detalhe.nome ?? detalhe.textoCompleto ?? value);
      }
    } catch {
      /* silencioso — usuário pode digitar manual */
    } finally {
      setResolvendo(false);
    }
  }

  return (
    <View className="gap-1">
      <View className="relative">
        <View className="absolute left-3 top-1/2 z-10 -translate-y-1/2">
          <Search size={16} color="#64748b" />
        </View>
        <Input
          value={value}
          onChangeText={(v) => {
            onChange(v);
            buscar(v);
          }}
          placeholder={placeholder}
          editable={!resolvendo}
          autoCapitalize="words"
          autoCorrect={false}
          className="pl-9"
        />
        {(loading || resolvendo) && (
          <View className="absolute right-3 top-1/2 -translate-y-1/2">
            <ActivityIndicator size="small" />
          </View>
        )}
      </View>

      {open && sugs.length > 0 && (
        <View className="rounded-lg border border-border bg-background">
          <FlatList
            data={sugs}
            keyExtractor={(s) => s.placeId}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 240 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => escolher(item)}
                className="flex-row items-start gap-2 border-b border-border px-3 py-3"
              >
                <View className="mt-0.5">
                  <MapPin size={14} color="#2563eb" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                    {item.nome}
                  </Text>
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {item.textoCompleto}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      )}
    </View>
  );
}
