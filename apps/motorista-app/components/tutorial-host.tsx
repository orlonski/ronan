import { useEffect, useState } from "react";
import { Dimensions, Modal, Pressable, Text, View } from "react-native";
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
 */
export function TutorialHost() {
  const [run, setRun] = useState<TutorialRun | null>(getTutorialRun());
  const [rect, setRect] = useState<CoachRect | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => subscribeTutorial(() => setRun(getTutorialRun())), []);

  const step = run ? run.steps[run.index] : null;
  const stepId = step?.id;
  const targetId = step?.targetId;

  // Mede o alvo quando o passo muda. Layout pode não estar pronto na hora
  // (FlatList header, navegação) — tenta de novo algumas vezes.
  useEffect(() => {
    let alive = true;
    if (!targetId) {
      setRect(null);
      return;
    }
    setRect(null);
    let tries = 0;
    const attempt = () => {
      if (!alive) return;
      const measurer = getCoachMeasurer(targetId);
      if (!measurer) {
        if (tries++ < 12) setTimeout(attempt, 80);
        return;
      }
      void measurer().then((r) => {
        if (!alive) return;
        if (r) {
          setRect(r);
          return;
        }
        if (tries++ < 12) setTimeout(attempt, 80);
      });
    };
    attempt();
    return () => {
      alive = false;
    };
  }, [stepId, targetId]);

  if (!run || !step) return null;

  const { width: W, height: H } = Dimensions.get("window");
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

  // Se o alvo estiver (mesmo que parcialmente) fora da tela — telas pequenas
  // com banners empurrando a lista —, cai pro balão centralizado em vez de
  // desenhar um furo invisível lá embaixo/em cima.
  const onScreen =
    !!rect &&
    rect.y >= insets.top &&
    rect.y + rect.height <= H - insets.bottom;
  const hasSpot = !!rect && onScreen;
  const sx = rect ? rect.x - SPOT_PAD : 0;
  const sy = rect ? rect.y - SPOT_PAD : 0;
  const sw = rect ? rect.width + SPOT_PAD * 2 : 0;
  const sh = rect ? rect.height + SPOT_PAD * 2 : 0;
  const isCircle = step.shape === "circle";
  const radius = isCircle ? Math.max(sw, sh) : 18;

  // Onde colocar o balão: embaixo do furo se couber, senão em cima.
  // Sem furo, centraliza verticalmente.
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
    // Sem statusBarTranslucent de propósito: no Android essa prop faz o Modal
    // desenhar a partir do topo físico (atrás da status bar), mas measureInWindow
    // mede relativo à janela do app — o descasamento jogava o furo pra cima.
    // No iOS a prop é ignorada (lá já estava alinhado).
    <Modal visible transparent animationType="fade">
      {hasSpot ? (
        <View className="flex-1">
          {/* painéis escuros ao redor do furo — capturam toque (sem passthrough
              pro botão real) pra não disparar ação no meio do tutorial */}
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
        <View className="flex-1 items-center justify-center bg-black/70 px-6">
          <View className="w-full max-w-sm">{tooltip}</View>
        </View>
      )}
    </Modal>
  );
}
