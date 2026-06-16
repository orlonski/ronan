import { useEffect, useRef } from "react";
import { View, type ViewProps } from "react-native";
import { registerCoachTarget, type CoachRect } from "@/lib/tutorial-state";

/**
 * Embrulha um elemento (botão, sino, etc) e registra a posição dele na janela
 * pro tutorial poder desenhar o furo (spotlight) por cima. Não muda o layout:
 * a View é transparente e estica como qualquer filho de flex.
 *
 * collapsable={false} é obrigatório no Android — sem isso a View pode ser
 * achatada na árvore nativa e measureInWindow retorna lixo.
 */
export function CoachTarget({
  id,
  children,
  ...rest
}: ViewProps & { id: string }) {
  const ref = useRef<View>(null);

  useEffect(() => {
    const measurer = () =>
      new Promise<CoachRect | null>((resolve) => {
        const node = ref.current;
        if (!node) {
          resolve(null);
          return;
        }
        node.measureInWindow((x, y, width, height) => {
          if (!width && !height) resolve(null);
          else resolve({ x, y, width, height });
        });
      });
    return registerCoachTarget(id, measurer);
  }, [id]);

  return (
    <View ref={ref} collapsable={false} {...rest}>
      {children}
    </View>
  );
}
