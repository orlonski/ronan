import { useState } from "react";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Clock } from "lucide-react-native";
import { Platform, Pressable, Text, View, Modal} from "react-native";
import { fmtHoraBR, isoDeDataHoraBR, minutosEntre, UM_DIA_MS } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * Campo de HORA com picker nativo (a mesma roda de relógio do sistema que o
 * campo Data já usa). Valor: ISO do INSTANTE; exibe "HH:MM" em horário de
 * Brasília.
 *
 * Por que picker e não máscara de digitação: o motorista está com o caminhão,
 * às vezes de luva, e digitar "07:30" num teclado numérico erra fácil. O picker
 * é um controle que ele já conhece de todo app, não deixa digitar hora inválida
 * e não precisa de máscara nenhuma.
 *
 * O módulo nativo (@react-native-community/datetimepicker) JÁ ESTÁ no binário
 * 1.0.5 por causa do DateField — por isso este campo alcança a frota por OTA.
 * Trocar por uma lib nova de picker exigiria build novo e deixaria todo mundo
 * pra trás.
 *
 * ⚠️ A hora escolhida é lida como hora de BRASÍLIA, não do fuso do aparelho.
 * O que a roda mostra é o que sai no painel e no comprovante do cliente; com
 * celular de fuso torto (acontece, ver posicao-periodica.ts) o motorista
 * escolheria 07:00 e a empresa leria outra coisa.
 */
export function HoraField({
  value,
  data,
  referencia,
  onChange,
  disabled,
  error,
  placeholder = "--:--",
}: {
  /** ISO do instante já escolhido, ou "" quando ainda não marcou. */
  value: string;
  /** "YYYY-MM-DD" da viagem — ancora o dia da hora escolhida. */
  data: string;
  /**
   * Hora de entrada (ISO), quando este campo é o de SAÍDA. Se a hora escolhida
   * cair antes dela, virou a noite e a saída vai pro dia seguinte.
   */
  referencia?: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  const texto = value ? fmtHoraBR(value) : placeholder;

  /**
   * Date que a roda abre mostrando. Precisa ter, no relógio LOCAL do aparelho,
   * a mesma hora que o valor tem em Brasília — senão a roda abriria numa hora
   * diferente da que a tela mostra logo acima dela.
   */
  function valorDoPicker(): Date {
    const agora = new Date();
    if (!value) return agora;
    const hhmm = fmtHoraBR(value);
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
    if (!m) return agora;
    const base = new Date();
    base.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return base;
  }

  function aoMudar(_: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") setOpen(false);
    if (!selected) return;
    // A roda entrega hora de parede; interpretamos como hora do Brasil.
    const hh = String(selected.getHours()).padStart(2, "0");
    const mm = String(selected.getMinutes()).padStart(2, "0");
    let iso = isoDeDataHoraBR(data, `${hh}:${mm}`);
    if (!iso) return;
    if (referencia) {
      const min = minutosEntre(referencia, iso);
      if (min != null && min <= 0) {
        iso = new Date(new Date(iso).getTime() + UM_DIA_MS).toISOString();
      }
    }
    onChange(iso);
  }

  return (
    <View>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={cn(
          "h-14 flex-row items-center justify-between rounded-xl border-2 bg-background px-4",
          error ? "border-destructive bg-destructive/5" : "border-border",
          disabled && "opacity-50",
        )}
      >
        <Text
          className={cn(
            "flex-1 text-[17px] font-medium",
            value ? "text-foreground" : "text-muted-foreground",
          )}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {texto}
        </Text>
        <Clock size={22} color="#64748b" />
      </Pressable>

      {/* ANDROID: diálogo nativo, já sai por cima. */}
      {open && Platform.OS !== "ios" && (
        <DateTimePicker
          value={valorDoPicker()}
          mode="time"
          is24Hour
          display="default"
          onChange={aoMudar}
          locale="pt-BR"
        />
      )}

      {/* iOS: folha por CIMA, pelo mesmo motivo do `DateField` — a roda
          renderizada no fluxo empurra o formulário e tira da tela o campo que
          a pessoa acabou de tocar. */}
      {Platform.OS === "ios" && (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)} />
          <View className="rounded-t-3xl bg-background px-4 pb-10 pt-3">
            <View className="mb-1 flex-row items-center justify-between">
              <Pressable onPress={() => setOpen(false)} className="px-2 py-2">
                <Text className="text-base font-medium text-muted-foreground">Cancelar</Text>
              </Pressable>
              <Text className="text-base font-semibold text-foreground">Escolha a hora</Text>
              <Pressable onPress={() => setOpen(false)} className="px-2 py-2">
                <Text className="text-base font-bold text-primary">Pronto</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={valorDoPicker()}
              mode="time"
              is24Hour
              display="spinner"
              onChange={aoMudar}
              locale="pt-BR"
            />
          </View>
        </Modal>
      )}
    </View>
  );
}
