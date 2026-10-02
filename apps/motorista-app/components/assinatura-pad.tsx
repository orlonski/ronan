import { useRef, useState } from "react";
import { PanResponder, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * Quadro de assinatura no dedo. Guarda o traço como `d` de path SVG num quadro
 * LÓGICO de 300×150 — independe do tamanho da tela, e é o que o painel e o
 * link público desenham de volta. Só react-native-svg + PanResponder (nada de
 * módulo nativo novo: vai por OTA).
 *
 * `onDesenhando` avisa a tela pra travar a rolagem enquanto o dedo está no
 * quadro — senão o ScrollView rouba o gesto no meio da assinatura.
 */
const W = 300;
const H = 150;

export function AssinaturaPad({
  valor,
  onChange,
  onDesenhando,
}: {
  valor: string;
  onChange: (d: string) => void;
  onDesenhando?: (ativo: boolean) => void;
}) {
  const tamanho = useRef({ w: 1, h: 1 });
  const atual = useRef(valor);
  const [d, setD] = useState(valor);
  atual.current = d;

  const ponto = (x: number, y: number) => {
    const px = Math.max(0, Math.min(W, (x / tamanho.current.w) * W));
    const py = Math.max(0, Math.min(H, (y / tamanho.current.h) * H));
    return `${px.toFixed(1)} ${py.toFixed(1)}`;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        onDesenhando?.(true);
        const novo = `${atual.current}${atual.current ? " " : ""}M ${ponto(e.nativeEvent.locationX, e.nativeEvent.locationY)}`;
        atual.current = novo;
        setD(novo);
      },
      onPanResponderMove: (e) => {
        const novo = `${atual.current} L ${ponto(e.nativeEvent.locationX, e.nativeEvent.locationY)}`;
        // Teto do traço (o servidor aceita até 30 mil caracteres).
        if (novo.length > 28_000) return;
        atual.current = novo;
        setD(novo);
      },
      onPanResponderRelease: () => {
        onDesenhando?.(false);
        onChange(atual.current);
      },
      onPanResponderTerminate: () => {
        onDesenhando?.(false);
        onChange(atual.current);
      },
    }),
  ).current;

  return (
    <View className="gap-2">
      <View
        className="h-40 overflow-hidden rounded-xl border-2 border-border bg-white"
        onLayout={(e: LayoutChangeEvent) => {
          tamanho.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        }}
        {...responder.panHandlers}
      >
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {d ? <Path d={d} stroke="#0f172a" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </Svg>
        {!d && (
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
            <Text className="text-base text-muted-foreground">Assine aqui com o dedo</Text>
          </View>
        )}
      </View>
      {d ? (
        <Pressable
          onPress={() => {
            atual.current = "";
            setD("");
            onChange("");
          }}
          className="self-start rounded-lg border-2 border-border px-3 py-1.5"
        >
          <Text className="text-sm font-semibold text-foreground">Apagar e assinar de novo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
