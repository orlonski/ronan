import { useCallback, useRef, useState } from "react";
import type { LayoutChangeEvent, ScrollView } from "react-native";
import { Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { AlertTriangle } from "lucide-react-native";

/**
 * Validação guiada pra motorista leigo: em vez de um errinho no rodapé, ao
 * faltar um campo a tela ROLA até ele, DESTACA em vermelho e mostra a frase
 * grande ali mesmo (via <ErroCampo>), com vibração. Sem pop-up.
 *
 * Uso:
 *   const v = useValidacaoGuiada();
 *   <ScrollView ref={v.scrollRef}>
 *     <View onLayout={v.onLayoutCampo("cliente")}>
 *       <Label error={!!v.erroDe("cliente")}>Cliente</Label>
 *       <Select error={!!v.erroDe("cliente")} onChange={(x)=>{ v.limpar(); ... }} .../>
 *       {v.erroDe("cliente") && <ErroCampo msg={v.erroDe("cliente")!} />}
 *   // no submit: if (!clienteId) return v.apontar("cliente", "Escolha o cliente");
 */
export function useValidacaoGuiada() {
  const scrollRef = useRef<ScrollView>(null);
  const posicoes = useRef<Record<string, number>>({});
  const [campoErro, setCampoErro] = useState<{ key: string; msg: string } | null>(null);

  const onLayoutCampo = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      posicoes.current[key] = e.nativeEvent.layout.y;
    },
    [],
  );

  const apontar = useCallback((key: string, msg: string): false => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setCampoErro({ key, msg });
    const y = posicoes.current[key] ?? 0;
    // pequeno atraso pra garantir que o layout/estado já atualizou antes de rolar
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    }, 60);
    return false;
  }, []);

  const limpar = useCallback(() => setCampoErro(null), []);

  const erroDe = useCallback(
    (key: string) => (campoErro?.key === key ? campoErro.msg : null),
    [campoErro],
  );

  return { scrollRef, onLayoutCampo, apontar, limpar, erroDe, campoErro };
}

/** Banner grande de erro ao lado do campo que falta (16px, ícone, vermelho). */
export function ErroCampo({ msg }: { msg: string }) {
  return (
    <View className="mt-1 flex-row items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2.5">
      <AlertTriangle size={20} color="#dc2626" />
      <Text className="flex-1 text-base font-bold text-destructive">{msg}</Text>
    </View>
  );
}
