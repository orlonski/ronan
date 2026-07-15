import { useCallback, useRef, useState, type ComponentRef } from "react";
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
  // Ref do View que embrulha TODO o conteúdo do ScrollView. measureLayout mede
  // relativo a ele (uma ref de componente — na nova arquitetura/Fabric passar
  // um node NUMBER não mede e cai no onFail). Attach: <View ref={v.conteudoRef}>.
  const conteudoRef = useRef<ComponentRef<typeof View>>(null);
  const posicoes = useRef<Record<string, number>>({});
  const nodes = useRef<Record<string, ComponentRef<typeof View> | null>>({});
  const [campoErro, setCampoErro] = useState<{ key: string; msg: string } | null>(null);

  // Fallback: y relativo ao pai direto. Só bate com o offset do ScrollView
  // quando o campo é filho DIRETO do conteúdo. Com cards <Secao> no meio o y
  // fica relativo ao card — por isso `apontar` prefere o measureLayout abaixo.
  const onLayoutCampo = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      posicoes.current[key] = e.nativeEvent.layout.y;
    },
    [],
  );

  // Ref do campo: permite medir a posição REAL dentro do ScrollView, mesmo
  // aninhado em cards. Use junto com onLayoutCampo (que vira só fallback).
  const refCampo = useCallback(
    (key: string) => (node: ComponentRef<typeof View> | null) => {
      nodes.current[key] = node;
    },
    [],
  );

  const rolarPara = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  }, []);

  // Mede o campo relativo ao container do conteúdo → y real de rolagem, mesmo
  // com o campo aninhado em cards. Fallback: o y do onLayout (só certo em
  // layout plano) se não houver ref medível.
  const medirERolar = useCallback(
    (key: string) => {
      const node = nodes.current[key];
      const alvo = conteudoRef.current;
      if (node && alvo && typeof node.measureLayout === "function") {
        try {
          node.measureLayout(
            alvo,
            (_x, y) => rolarPara(y),
            () => rolarPara(posicoes.current[key] ?? 0),
          );
        } catch {
          rolarPara(posicoes.current[key] ?? 0);
        }
      } else {
        rolarPara(posicoes.current[key] ?? 0);
      }
    },
    [rolarPara],
  );

  const apontar = useCallback(
    (key: string, msg: string): false => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCampoErro({ key, msg });
      // pequeno atraso pra garantir que o layout/estado já atualizou antes de rolar
      setTimeout(() => medirERolar(key), 60);
      return false;
    },
    [medirERolar],
  );

  // Rola até um campo SEM marcar erro nem vibrar (ex: levar o motorista até o
  // card de km após escolher carga+descarga). Delay maior: dá tempo do card
  // (seletor de rota/retorno) montar antes de medir.
  const rolarAte = useCallback(
    (key: string) => {
      setTimeout(() => medirERolar(key), 200);
    },
    [medirERolar],
  );

  const limpar = useCallback(() => setCampoErro(null), []);

  const erroDe = useCallback(
    (key: string) => (campoErro?.key === key ? campoErro.msg : null),
    [campoErro],
  );

  return {
    scrollRef,
    conteudoRef,
    onLayoutCampo,
    refCampo,
    apontar,
    rolarAte,
    limpar,
    erroDe,
    campoErro,
  };
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
