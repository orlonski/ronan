import { useEffect } from "react";
import { View, type ViewProps } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { cn } from "@/lib/utils";

/**
 * Skeleton com pulse sutil (opacidade 0.6 -> 1.0). Usar pra estados
 * de loading no lugar de spinner — comunica melhor o que vai aparecer.
 */
export function Skeleton({ className, ...props }: ViewProps & { className?: string }) {
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={style}
      className={cn("rounded-lg bg-muted", className)}
      {...props}
    />
  );
}

export function ViagemCardSkeleton() {
  return (
    <View className="rounded-2xl border-2 border-border bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </View>
        <Skeleton className="h-6 w-20 rounded-md" />
      </View>
      <View className="mt-4 gap-2">
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </View>
      <View className="mt-4 flex-row gap-5 border-t-2 border-border pt-3">
        <Skeleton className="h-10 w-12" />
        <Skeleton className="h-10 w-12" />
        <Skeleton className="h-10 w-16" />
      </View>
    </View>
  );
}
