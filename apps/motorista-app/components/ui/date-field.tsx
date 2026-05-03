import { useState } from "react";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Calendar } from "lucide-react-native";
import { Platform, Pressable, Text, View } from "react-native";
import { cn } from "@/lib/utils";

/**
 * Campo de data com picker nativo. Valor: ISO 'YYYY-MM-DD'.
 * Mostra DD/MM/YYYY ao usuário; faz round-trip em ISO pro backend.
 */
export function DateField({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const date = parseDate(value);
  const display = formatBR(date);

  function abrir() {
    if (disabled) return;
    setOpen(true);
  }

  function aoMudar(_: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") setOpen(false);
    if (!selected) return;
    onChange(toISO(selected));
  }

  return (
    <View>
      <Pressable
        onPress={abrir}
        disabled={disabled}
        className={cn(
          "h-14 flex-row items-center justify-between rounded-xl border-2 border-border bg-background px-4",
          disabled && "opacity-50",
          className,
        )}
      >
        <Text className="flex-1 text-[17px] font-medium text-foreground">
          {display}
        </Text>
        <Calendar size={22} color="#64748b" />
      </Pressable>

      {open && (
        <View>
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={aoMudar}
            locale="pt-BR"
          />
          {Platform.OS === "ios" && (
            <View className="mt-2 items-end">
              <Pressable
                onPress={() => setOpen(false)}
                className="rounded-md px-3 py-1.5"
              >
                <Text className="text-sm font-medium text-primary">OK</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function parseDate(iso: string): Date {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatBR(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day}/${m}/${y}`;
}
