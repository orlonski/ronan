import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react-native";
import {
  resolveAlert,
  subscribeAlert,
  type AlertOptions,
  type AlertVariant,
} from "@/lib/alert";
import { cn } from "@/lib/utils";

const ICONS: Record<AlertVariant, typeof Info> = {
  default: Info,
  warning: AlertTriangle,
  destructive: XCircle,
};

const ICON_BG: Record<AlertVariant, string> = {
  default: "bg-primary",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

const ICON_COLOR: Record<AlertVariant, string> = {
  default: "#ffffff",
  warning: "#0f172a",
  destructive: "#ffffff",
};

const BUTTON_STYLES = {
  default: { bg: "bg-primary", text: "text-primary-foreground" },
  outline: { bg: "border-2 border-border bg-card", text: "text-foreground" },
  destructive: { bg: "bg-destructive", text: "text-destructive-foreground" },
  cancel: { bg: "bg-muted", text: "text-foreground" },
} as const;

type Current = { id: string; opts: AlertOptions } | null;

/**
 * Mount uma vez em _layout.tsx. Escuta a fila de showAlert() e renderiza
 * o Modal estilizado. Só mostra um por vez — próximos ficam na fila.
 */
export function AlertHost() {
  const [current, setCurrent] = useState<Current>(null);

  useEffect(() => {
    return subscribeAlert((q) => {
      setCurrent(q[0] ? { id: q[0].id, opts: q[0].opts } : null);
    });
  }, []);

  if (!current) return null;

  const { id, opts } = current;
  const variant = opts.variant ?? "default";
  const buttons = opts.buttons ?? [{ label: "OK", value: "ok" }];
  const Icon = ICONS[variant];

  function press(value: string | null) {
    resolveAlert(id, value);
  }

  function dismiss() {
    if (opts.dismissible === false) return;
    press(null);
  }

  // Layout dos botões: lado a lado quando são poucos e curtos; empilhados
  // (full-width) quando são 3+ OU quando algum rótulo é longo — senão em tela
  // pequena (ex: iPhone 15) o texto corta com "…".
  const rotuloLongo = buttons.some((b) => b.label.length > 15);
  const stacked = buttons.length >= 3 || rotuloLongo;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <Pressable
        onPress={dismiss}
        className="flex-1 items-center justify-center bg-black/50 px-6"
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-3xl bg-card p-6"
          style={{
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}
        >
          <View className="items-center">
            <View
              className={cn(
                "h-14 w-14 items-center justify-center rounded-full",
                ICON_BG[variant],
              )}
            >
              <Icon size={28} color={ICON_COLOR[variant]} strokeWidth={2.5} />
            </View>
            <Text className="mt-4 text-center text-xl font-bold text-foreground">
              {opts.title}
            </Text>
            {opts.message ? (
              <Text className="mt-2 text-center text-base leading-6 text-muted-foreground">
                {opts.message}
              </Text>
            ) : null}
          </View>

          <View className={cn("mt-6", stacked ? "gap-2" : "flex-row gap-3")}>
            {buttons.map((b, i) => {
              const style = BUTTON_STYLES[b.style ?? "default"];
              return (
                <Pressable
                  key={`${b.label}-${i}`}
                  onPress={() => press(b.value ?? b.label)}
                  className={cn(
                    "h-14 items-center justify-center rounded-xl px-4 active:opacity-75",
                    style.bg,
                    stacked ? "w-full" : "flex-1",
                  )}
                >
                  <Text
                    className={cn("text-center text-base font-bold", style.text)}
                    numberOfLines={stacked ? 2 : 1}
                  >
                    {b.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// re-export para a UI shadcn-like
export { showAlert, showConfirm } from "@/lib/alert";

// helper de sucesso (verde)
export function CheckIcon() {
  return <CheckCircle2 size={28} color="#ffffff" strokeWidth={2.5} />;
}
