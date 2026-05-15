import { cn } from "@/lib/utils";

/**
 * Logo da Schaba que herda cor do contexto via `currentColor` (mask-image).
 * Use `className` com tokens de tema (`text-foreground`, `text-primary`, etc.)
 * pra controlar a cor — o logo se adapta ao tema automaticamente.
 *
 * Por padrão usa `text-foreground` (preto em light, branco em dark).
 */
export function SchabaLogo({
  className,
  width = 160,
  height,
}: {
  className?: string;
  /** Largura em pixels (default 160). Altura é calculada proporcional. */
  width?: number;
  /** Altura em pixels. Se omitida, usa proporção 1642x614. */
  height?: number;
}) {
  const aspectRatio = 1642 / 614;
  const computedHeight = height ?? Math.round(width / aspectRatio);

  return (
    <div
      role="img"
      aria-label="Schaba"
      className={cn("bg-current text-foreground", className)}
      style={{
        width: `${width}px`,
        height: `${computedHeight}px`,
        WebkitMaskImage: "url(/schaba-logo.png)",
        maskImage: "url(/schaba-logo.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
