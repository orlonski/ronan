"use client";

/**
 * Mini-gráfico SVG sem dependência. Recebe array de números, normaliza
 * pra um path com curva suave + área preenchida com gradiente.
 *
 * Quando `data` está toda zerada, mostra linha reta no chão (não fica feio
 * com NaN). Container é responsivo via viewBox + preserveAspectRatio.
 */
export function Sparkline({
  data,
  width = 600,
  height = 80,
  color = "rgb(37, 99, 235)", // blue-600
  strokeWidth = 2,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}) {
  if (data.length === 0) return null;

  const padding = strokeWidth + 1;
  const w = width;
  const h = height;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;

  const max = Math.max(...data, 1);
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const pontos = data.map((v, i) => {
    const x = padding + i * stepX;
    const y = padding + innerH - (v / max) * innerH;
    return [x, y] as const;
  });

  // Bézier suave entre pontos: cada segmento usa control points horizontais
  // proporcionais à distância (resulta em curva natural sem overshoot).
  const linhaPath = pontos
    .map(([x, y], i) => {
      if (i === 0) return `M ${x} ${y}`;
      const [px, py] = pontos[i - 1]!;
      const cpDx = (x - px) / 2;
      return `C ${px + cpDx} ${py} ${x - cpDx} ${y} ${x} ${y}`;
    })
    .join(" ");

  const areaPath =
    `${linhaPath} L ${pontos[pontos.length - 1]![0]} ${padding + innerH} ` +
    `L ${pontos[0]![0]} ${padding + innerH} Z`;

  const gradId = `sparkline-grad-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
      role="img"
      aria-label="Gráfico de tendência"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linhaPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
