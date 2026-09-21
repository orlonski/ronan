import { useState } from "react";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Calendar } from "lucide-react-native";
import { Modal, Platform, Pressable, Text, View } from "react-native";
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
  error,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  error?: boolean;
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
          "h-14 flex-row items-center justify-between rounded-xl border-2 bg-background px-4",
          error ? "border-destructive bg-destructive/5" : "border-border",
          disabled && "opacity-50",
          className,
        )}
      >
        <Text className="flex-1 text-[17px] font-medium text-foreground">
          {display}
        </Text>
        <Calendar size={22} color="#64748b" />
      </Pressable>

      {/* ANDROID: diálogo nativo, já sai por cima. */}
      {open && Platform.OS !== "ios" && (
        <DateTimePicker value={date} mode="date" display="default" onChange={aoMudar} locale="pt-BR" />
      )}

      {/* iOS: folha por CIMA, nunca inline.
          
          ⚠️ Renderizado no fluxo (como era), o calendário do iOS empurra o
          formulário inteiro pra baixo: o campo que a pessoa tocou sai da
          tela e o resto do formulário some. Numa tela de correção — em que
          ela precisa VER o que está corrigindo — isso é perder o contexto no
          momento exato em que ele importa. */}
      {Platform.OS === "ios" && (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)} />
          <View className="rounded-t-3xl bg-background px-4 pb-10 pt-3">
            <View className="mb-1 flex-row items-center justify-between">
              <Pressable onPress={() => setOpen(false)} className="px-2 py-2">
                <Text className="text-base font-medium text-muted-foreground">Cancelar</Text>
              </Pressable>
              <Text className="text-base font-semibold text-foreground">Escolha o dia</Text>
              <Pressable onPress={() => setOpen(false)} className="px-2 py-2">
                <Text className="text-base font-bold text-primary">Pronto</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={date}
              mode="date"
              display="inline"
              onChange={aoMudar}
              locale="pt-BR"
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

function parseDate(iso: string): Date {
  // Parse manual: "YYYY-MM-DD" no horario LOCAL, nao UTC. Senao em UTC-3
  // o getDate() retorna o dia anterior.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
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
