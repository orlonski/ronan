"use client";

import { useState } from "react";

type DiaAnalise = { dia: string; humano: number; automatico: number };

/**
 * Gráfico de barras (análises por dia) empilhado por origem — usuário vs
 * agente automático — no mesmo espírito do TendenciaChart: CSS/flex puro, sem
 * lib de charts, com tooltip da quebra no hover.
 */
export function AnalisesChart({
  data,
  height = 120,
}: {
  data: Array<DiaAnalise>;
  height?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) return null;

  const totais = data.map((d) => d.humano + d.automatico);
  const max = Math.max(...totais, 1);
  const ultimoIdx = data.length - 1;

  return (
    <div>
      <div className="relative flex items-end gap-1 sm:gap-1.5" style={{ height }}>
        {data.map((d, i) => {
          const total = d.humano + d.automatico;
          const alturaPct = (total / max) * 100;
          const hover = i === hoverIdx;
          return (
            <div
              key={d.dia}
              className="group relative flex h-full flex-1 flex-col justify-end"
              onPointerEnter={() => setHoverIdx(i)}
              onPointerLeave={() => setHoverIdx((prev) => (prev === i ? null : prev))}
            >
              {hover && (
                <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md">
                  <span className="font-semibold">{total}</span>{" "}
                  {total === 1 ? "análise" : "análises"}
                  <span className="text-muted-foreground"> · {fmtDiaCompleto(d.dia)}</span>
                  {total > 0 && (
                    <div className="mt-1 space-y-0.5 border-t border-border pt-1">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-sm bg-sky-500" />
                        <span className="text-muted-foreground">Usuário</span>
                        <span className="ml-auto font-medium tabular-nums">{d.humano}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-sm bg-violet-500" />
                        <span className="text-muted-foreground">Agente automático</span>
                        <span className="ml-auto font-medium tabular-nums">{d.automatico}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t transition-[height,opacity] duration-300"
                style={{
                  height: `${alturaPct}%`,
                  minHeight: 3,
                  opacity: hover ? 1 : 0.8,
                }}
              >
                {total === 0 ? (
                  <div className="h-full w-full bg-muted-foreground/30" />
                ) : (
                  <>
                    {d.automatico > 0 && (
                      <div
                        className="bg-violet-500"
                        style={{ flexGrow: d.automatico, flexBasis: 0 }}
                      />
                    )}
                    {d.humano > 0 && (
                      <div className="bg-sky-500" style={{ flexGrow: d.humano, flexBasis: 0 }} />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-1 sm:gap-1.5">
        {data.map((d, i) => (
          <div
            key={d.dia}
            className={`flex-1 text-center text-[10px] tabular-nums ${
              i === ultimoIdx ? "font-bold text-foreground" : "text-muted-foreground"
            }`}
          >
            {inicialDiaSemana(d.dia)}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 shrink-0 rounded-sm bg-sky-500" />
          Usuário
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 shrink-0 rounded-sm bg-violet-500" />
          Agente automático
        </div>
      </div>
    </div>
  );
}

// Parse local (YYYY-MM-DD) sem shift de timezone.
function parseDia(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DIAS_LONGO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function inicialDiaSemana(dia: string): string {
  return DIAS[parseDia(dia).getDay()] ?? "";
}

function fmtDiaCompleto(dia: string): string {
  const dt = parseDia(dia);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${DIAS_LONGO[dt.getDay()]}, ${dd}/${mm}`;
}
