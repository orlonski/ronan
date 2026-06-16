import { useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  advanceTutorial,
  backTutorial,
  finishTutorial,
  getCoachMeasurer,
  getTutorialRun,
  subscribeTutorial,
  type CoachRect,
  type TutorialRun,
} from "@/lib/tutorial-state";

// Espaço escuro ao redor do alvo e altura estimada do balão pra decidir se ele
// cabe embaixo do furo ou se vai pra cima.
const SPOT_PAD = 10;
const TOOLTIP_EST_HEIGHT = 210;
const GAP = 14;

/**
 * Monte uma vez em _layout.tsx (junto do AlertHost). Escuta a sequência ativa
 * do tutorial, mede o alvo do passo atual e desenha:
 *  - 4 painéis escuros ao redor do alvo (deixando o "furo" transparente);
 *  - um anel branco no furo;
 *  - um balão com título, texto, contador e botões Pular/Próximo.
 * Sem alvo (targetId ausente) → fundo escuro cheio + card centralizado.
 *
 * NÃO usa <Modal>: no Android (edge-to-edge, SDK 54) o Modal vive numa janela
 * separada, então measureInWindow do botão (janela do app) e o desenho (janela
 * do Modal) ficam em sistemas de coordenadas diferentes — o furo saía deslocado.
 * Aqui o overlay é um View absoluto na MESMA janela dos botões, e a posição do
 * alvo é calculada relativa à origem do próprio overlay (mede os dois e subtrai),
 * o que cancela qualquer offset de status/nav bar nos dois sistemas.
 */
export function TutorialHost() {
  const [run, setRun] = useState<TutorialRun | null>(getTutorialRun());
  const [rect, setRect] = useState<CoachRect | null>(null);
  const hostRef = useRef<View>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => subscribeTutorial(() => setRun(getTutorialRun())), []);

  const step = run ? run.steps[run.index] : null;
  const stepId = step?.id;
  const targetId = step?.targetId;

  // Mede o alvo quando o passo muda. Layout pode não estar pronto na hora
  // (FlatList header, navegação) — tenta de novo algumas vezes. Mede o alvo E
  // a origem do overlay e subtrai → coordenadas relativas ao overlay.
  useEffect(() => {
    let alive = true;
    if (!targetId) {
      setRect(null);
      return;
    }
    setRect(null);
    let tries = 0;
    const retry = () => {
      if (tries++ < 15 && alive) setTimeout(attempt, 80);
    };
    const attempt = () => {
      if (!alive) return;
      const measurer = getCoachMeasurer(targetId);
      const host = hostRef.current;
      if (!measurer || !host) {
        retry();
        return;
      }
      void measurer().then((r) => {
        if (!alive) return;
        if (!r) {
          retry();
          return;
        }
        host.measureInWindow((hx, hy) => {
          if (!alive) return;
          setRect({
            x: r.x - hx,
            y: r.y - hy,
            width: r.width,
            height: r.height,
          });
        });
      });
    };
    attempt();
    return () => {
      alive = false;
    };
  }, [stepId, targetId]);

  if (!run || !step) return null;

  const { height: H } = Dimensions.get("window");
  const total = run.steps.length;
  const isLast = run.index === total - 1;
  const isFirst = run.index === 0;

  function next() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    advanceTutorial();
  }
  function skip() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    finishTutorial();
  }
  function back() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backTutorial();
  }

  const sx = rect ? rect.x - SPOT_PAD : 0;
  const sy = rect ? rect.y - SPOT_PAD : 0;
  const sw = rect ? rect.width + SPOT_PAD * 2 : 0;
  const sh = rect ? rect.height + SPOT_PAD * 2 : 0;

  // Cai pro balão centralizado se o alvo está fora da área visível (telas
  // pequenas com banners empurrando a lista) — furo invisível confunde.
  const onScreen = !!rect && sy + sh > 0 && sy < H;
  const hasSpot = !!rect && onScreen;
  const isCircle = step.shape === "circle";
  const radius = isCircle ? Math.max(sw, sh) : 18;

  // Onde colocar o balão: embaixo do furo se couber, senão em cima.
  const spaceBelow = H - (sy + sh);
  const placeBelow = spaceBelow >= TOOLTIP_EST_HEIGHT + insets.bottom;

  const tooltip = (
    <Animated.View
      key={step.id}
      entering={FadeIn.duration(180)}
      className="rounded-3xl bg-card p-5"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 14,
      }}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-bold uppercase tracking-wider text-primary">
          {run.index + 1} de {total}
        </Text>
        {!isLast && (
          <Pressable onPress={skip} hitSlop={10} className="active:opacity-60">
            <Text className="text-sm font-semibold text-muted-foreground">
              Pular
            </Text>
          </Pressable>
        )}
      </View>

      <Text className="mt-3 text-xl font-extrabold text-foreground">
        {step.title}
      </Text>
      <Text className="mt-1.5 text-base leading-6 text-muted-foreground">
        {step.body}
      </Text>

      {/* indicador de progresso em pontinhos */}
      <View className="mt-4 flex-row gap-1.5">
        {run.steps.map((s, i) => (
          <View
            key={s.id}
            className={
              i === run.index
                ? "h-2 w-5 rounded-full bg-primary"
                : "h-2 w-2 rounded-full bg-muted"
            }
          />
        ))}
      </View>

      <View className="mt-5 flex-row gap-3">
        {!isFirst && (
          <Pressable
            onPress={back}
            className="h-14 items-center justify-center rounded-xl bg-muted px-5 active:opacity-75"
          >
            <Text className="text-base font-bold text-foreground">Voltar</Text>
          </Pressable>
        )}
        <Pressable
          onPress={next}
          className="h-14 flex-1 items-center justify-center rounded-xl bg-primary px-5 active:opacity-85"
        >
          <Text className="text-base font-bold text-primary-foreground">
            {isLast ? "Entendi!" : "Próximo"}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );

  return (
    // Overlay absoluto na mesma janela. O View raiz captura os toques (inclusive
    // no "furo") pra não disparar o botão real no meio do tutorial.
    <View
      ref={hostRef}
      style={[StyleSheet.absoluteFillObject, { zIndex: 9999, elevation: 9999 }]}
    >
      <Animated.View
        key={run.key}
        entering={FadeIn.duration(150)}
        style={StyleSheet.absoluteFillObject}
      >
        {hasSpot ? (
          <View style={StyleSheet.absoluteFillObject}>
            {/* painéis escuros ao redor do furo */}
            <View
              style={{ position: "absolute", left: 0, top: 0, right: 0, height: sy }}
              className="bg-black/70"
            />
            <View
              style={{ position: "absolute", left: 0, top: sy + sh, right: 0, bottom: 0 }}
              className="bg-black/70"
            />
            <View
              style={{ position: "absolute", left: 0, top: sy, width: sx, height: sh }}
              className="bg-black/70"
            />
            <View
              style={{
                position: "absolute",
                left: sx + sw,
                top: sy,
                right: 0,
                height: sh,
              }}
              className="bg-black/70"
            />

            {/* anel destacando o alvo */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: sx,
                top: sy,
                width: sw,
                height: sh,
                borderRadius: radius,
                borderWidth: 3,
                borderColor: "#ffffff",
              }}
            />

            {/* balão posicionado acima/abaixo do furo */}
            <View
              style={{
                position: "absolute",
                left: 16,
                right: 16,
                ...(placeBelow
                  ? { top: sy + sh + GAP }
                  : { bottom: H - sy + GAP }),
              }}
            >
              {tooltip}
            </View>
          </View>
        ) : (
          <View
            style={StyleSheet.absoluteFillObject}
            className="items-center justify-center bg-black/70 px-6"
          >
            <View className="w-full max-w-sm">{tooltip}</View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}
