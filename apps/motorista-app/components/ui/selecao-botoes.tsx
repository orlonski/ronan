import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import type { SelectOption } from "@/components/ui/select";

/**
 * Seleção por BOTÕES grandes (glanceável, 1 toque) — pra listas CURTAS. Substitui
 * o dropdown (que esconde as opções e custa 2 toques) quando há poucas opções.
 * Alvos grandes (py-4 ≈ 52px) e espaçados, pensados pro "motorista dedão".
 * Mesma interface do Select (value/onChange/options) pra trocar sem atrito.
 */
export function SelecaoBotoes({
  value,
  onChange,
  options,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  error?: boolean;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            className={
              sel
                ? "flex-row items-center gap-2 rounded-2xl border-2 border-primary bg-primary/10 px-4 py-4 active:opacity-80"
                : error
                  ? "flex-row items-center gap-2 rounded-2xl border-2 border-destructive bg-card px-4 py-4 active:opacity-70"
                  : "flex-row items-center gap-2 rounded-2xl border-2 border-border bg-card px-4 py-4 active:opacity-70"
            }
          >
            {sel && <Check size={18} color="#2563eb" strokeWidth={3} />}
            <Text
              className={
                sel
                  ? "text-base font-bold text-primary"
                  : "text-base font-medium text-foreground"
              }
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
