"use client";

import { useState } from "react";
import {
  STATUS_VIAGEM_CHART_COLOR,
  STATUS_VIAGEM_LABEL,
  STATUS_VIAGEM_TENDENCIA_ORDEM,
} from "@/lib/status-viagem";

type DiaTendencia = { dia: string; total: number; porStatus: Record<string, number> };

/**
 * Gráfico de barras (viagens por dia) sem dependência de lib de charts —
 * CSS/flex puro, crisp e responsivo. Cada barra é empilhada por status da
 * viagem (mesma cor do badge de status em `lib/status-viagem.tsx`), destaca o
 * dia de pico, mostra linha de média, legenda e tooltip com a quebra por
 * status no hover. Trata dados vazios / tudo-zero sem quebrar (barras viram
 * slivers, média fica no chão).
 */
export function TendenciaChart({
  data,
  height = 140,
}: {
  data: Array<DiaTendencia>;
  height?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) return null;

  const totais = data.map((d) => d.total);
  const max = Math.max(...totais, 1);
  const soma = totais.reduce((a, b) => a + b, 0);
  const media = soma / totais.length;
  const maxIdx = totais.indexOf(Math.max(...totais));
  const ultimoIdx = data.length - 1;
  const statusPresentes = STATUS_VIAGEM_TENDENCIA_ORDEM.filter((s) =>
    data.some((d) => (d.porStatus[s] ?? 0) > 0),
  );

  return (
    <div>
      {/* Área das barras */}
      <div className="relative flex items-end gap-1 sm:gap-1.5" style={{ height }}>
        {/* Linha de média (pontilhada) */}
        {soma > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
            style={{ bottom: `${(media / max) * 100}%` }}
          >
            <span className="absolute -top-2.5 right-0 bg-card px-1 text-[10px] font-medium text-muted-foreground">
              média {arred(media)}
            </span>
          </div>
        )}

        {data.map((d, i) => {
          const fds = ehFimDeSemana(d.dia);
          const pico = i === maxIdx && d.total > 0;
          const hover = i === hoverIdx;
          const alturaPct = (d.total / max) * 100;
          return (
            <div
              key={d.dia}
              className="group relative flex h-full flex-1 flex-col justify-end"
              onPointerEnter={() => setHoverIdx(i)}
              onPointerLeave={() => setHoverIdx((prev) => (prev === i ? null : prev))}
            >
              {/* Valor do pico acima da barra */}
              {pico && (
                <span className="mb-1 text-center text-xs font-bold tabular-nums text-foreground">
                  {d.total}
                </span>
              )}

              {/* Tooltip no hover */}
              {hover && (
                <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md">
                  <span className="font-semibold">{d.total}</span>{" "}
                  {d.total === 1 ? "viagem" : "viagens"}
                  <span className="text-muted-foreground"> · {fmtDiaCompleto(d.dia)}</span>
                  {d.total > 0 && (
                    <div className="mt-1 space-y-0.5 border-t border-border pt-1">
                      {STATUS_VIAGEM_TENDENCIA_ORDEM.filter((s) => (d.porStatus[s] ?? 0) > 0).map(
                        (status) => (
                          <div key={status} className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-sm"
                              style={{ backgroundColor: STATUS_VIAGEM_CHART_COLOR[status] }}
                            />
                            <span className="text-muted-foreground">
                              {STATUS_VIAGEM_LABEL[status] ?? status}
                            </span>
                            <span className="ml-auto font-medium tabular-nums">
                              {d.porStatus[status]}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Barra empilhada por status */}
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t transition-[height,opacity] duration-300"
                style={{
                  height: `${alturaPct}%`,
                  minHeight: 3,
                  opacity: hover ? 1 : pico ? 0.95 : fds ? 0.4 : 0.7,
                }}
              >
                {d.total === 0 ? (
                  <div className="h-full w-full bg-muted-foreground/30" />
                ) : (
                  STATUS_VIAGEM_TENDENCIA_ORDEM.filter((s) => (d.porStatus[s] ?? 0) > 0).map(
                    (status) => (
                      <div
                        key={status}
                        style={{
                          flexGrow: d.porStatus[status],
                          flexBasis: 0,
                          backgroundColor: STATUS_VIAGEM_CHART_COLOR[status],
                        }}
                      />
                    ),
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rótulos dos dias */}
      <div className="mt-1.5 flex gap-1 sm:gap-1.5">
        {data.map((d, i) => (
          <div
            key={d.dia}
            className={`flex-1 text-center text-[10px] tabular-nums ${
              i === ultimoIdx
                ? "font-bold text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {inicialDiaSemana(d.dia)}
          </div>
        ))}
      </div>

      {/* Legenda dos status presentes no período */}
      {statusPresentes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {statusPresentes.map((status) => (
            <div key={status} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: STATUS_VIAGEM_CHART_COLOR[status] }}
              />
              {STATUS_VIAGEM_LABEL[status] ?? status}
            </div>
          ))}
        </div>
      )}
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

function ehFimDeSemana(dia: string): boolean {
  const g = parseDia(dia).getDay();
  return g === 0 || g === 6;
}

function fmtDiaCompleto(dia: string): string {
  const dt = parseDia(dia);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${DIAS_LONGO[dt.getDay()]}, ${dd}/${mm}`;
}

function arred(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
