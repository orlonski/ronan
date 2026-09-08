"use client";

import { useState } from "react";
import {
  ORIGEM_CONFERENCIA_LABEL,
  ORIGENS_CONFERENCIA,
  type FaixaTempoConferencia,
  type OrigemConferencia,
  type PeriodoConferencia,
} from "@ronan/shared-types";
import { fmtDuracaoSegundos } from "@/lib/duracao";

/**
 * Os três gráficos do histórico de conferência. CSS/flex puro, no mesmo espírito
 * do `AnalisesChart` e do `TendenciaChart` — o painel não carrega lib de charts
 * e não vale carregar uma por três barras.
 *
 * A escala do tempo é LINEAR, e é isso que faz a tela responder a pergunta: com
 * a conferência humana medindo dias e a automática medindo minutos, a barra da
 * IA virar um traço no rodapé é a mensagem, não um defeito. Log achataria
 * justamente a diferença que se quer ver.
 */

export const COR_ORIGEM: Record<OrigemConferencia, string> = {
  HUMANO: "bg-sky-500",
  IA: "bg-violet-500",
  DISPENSA: "bg-slate-400",
  OUTRO: "bg-slate-300",
};

/** Origens que têm tempo de espera pra comparar — ver `ORIGENS_CONFERENCIA`. */
const ORIGENS_COM_TEMPO: OrigemConferencia[] = ["HUMANO", "IA"];

export function TempoPorPeriodoChart({
  periodos,
  height = 180,
}: {
  periodos: PeriodoConferencia[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (periodos.length === 0) return null;

  const max = Math.max(
    1,
    ...periodos.flatMap((p) =>
      ORIGENS_COM_TEMPO.map((o) => p.porOrigem[o].medianaSegundos ?? 0),
    ),
  );

  return (
    <div>
      <div className="flex items-end gap-1 sm:gap-2" style={{ height }}>
        {periodos.map((p, i) => (
          <div
            key={p.chave}
            className="relative flex h-full flex-1 items-end justify-center gap-0.5"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((v) => (v === i ? null : v))}
          >
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md">
                <div className="font-semibold">{p.rotulo}</div>
                {p.total === 0 ? (
                  <div className="text-muted-foreground">Nenhuma conferência</div>
                ) : (
                  <div className="mt-1 space-y-0.5 border-t border-border pt-1">
                    {ORIGENS_COM_TEMPO.map((o) => (
                      <LinhaTooltip key={o} origem={o} stat={p.porOrigem[o]} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {ORIGENS_COM_TEMPO.map((o) => {
              const mediana = p.porOrigem[o].medianaSegundos;
              return (
                <div
                  key={o}
                  className={`w-full max-w-[18px] rounded-t transition-[height] duration-300 ${
                    mediana == null ? "" : COR_ORIGEM[o]
                  }`}
                  style={{
                    height: mediana == null ? 0 : `${Math.max((mediana / max) * 100, 1.5)}%`,
                    opacity: hover === i ? 1 : 0.85,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <EixoPeriodos periodos={periodos} />
      <Legenda origens={ORIGENS_COM_TEMPO} />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Altura = mediana do tempo entre a viagem chegar no servidor e ser conferida. O topo da
        escala é {fmtDuracaoSegundos(max)}.
      </p>
    </div>
  );
}

/**
 * Volume por período, empilhado por quem conferiu. Anda junto do gráfico de
 * tempo porque um sem o outro engana: mediana boa em cima de três viagens não
 * quer dizer nada, e é aqui que dá pra ver quantas o robô assumiu.
 */
export function VolumePorPeriodoChart({
  periodos,
  height = 120,
}: {
  periodos: PeriodoConferencia[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (periodos.length === 0) return null;

  const max = Math.max(1, ...periodos.map((p) => p.total));

  return (
    <div>
      <div className="flex items-end gap-1 sm:gap-1.5" style={{ height }}>
        {periodos.map((p, i) => (
          <div
            key={p.chave}
            className="relative flex h-full flex-1 flex-col justify-end"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((v) => (v === i ? null : v))}
          >
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md">
                <div>
                  <span className="font-semibold">{p.total}</span>{" "}
                  {p.total === 1 ? "conferência" : "conferências"}
                  <span className="text-muted-foreground"> · {p.rotulo}</span>
                </div>
                {p.total > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-border pt-1">
                    {ORIGENS_CONFERENCIA.filter((o) => p.porOrigem[o].n > 0).map((o) => (
                      <div key={o} className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 rounded-sm ${COR_ORIGEM[o]}`} />
                        <span className="text-muted-foreground">
                          {ORIGEM_CONFERENCIA_LABEL[o]}
                        </span>
                        <span className="ml-auto font-medium tabular-nums">
                          {p.porOrigem[o].n}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-t transition-[height] duration-300"
              style={{
                height: `${(p.total / max) * 100}%`,
                minHeight: 3,
                opacity: hover === i ? 1 : 0.85,
              }}
            >
              {p.total === 0 ? (
                <div className="h-full w-full bg-muted-foreground/30" />
              ) : (
                ORIGENS_CONFERENCIA.filter((o) => p.porOrigem[o].n > 0).map((o) => (
                  <div
                    key={o}
                    className={COR_ORIGEM[o]}
                    style={{ flexGrow: p.porOrigem[o].n, flexBasis: 0 }}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <EixoPeriodos periodos={periodos} />
      {/* Só as origens que aparecem: legenda com "Sem origem registrada" zerado
          faz a pessoa procurar na tela uma cor que não está lá. */}
      <Legenda
        origens={ORIGENS_CONFERENCIA.filter((o) =>
          periodos.some((p) => p.porOrigem[o].n > 0),
        )}
      />
    </div>
  );
}

/**
 * Distribuição por faixa de tempo. É a foto que a mediana não dá: mostra a cauda
 * de conferências que levaram dias, e se ela encolheu.
 */
export function FaixasChart({ faixas }: { faixas: FaixaTempoConferencia[] }) {
  const max = Math.max(1, ...faixas.map((f) => f.total));
  const total = faixas.reduce((a, f) => a + f.total, 0);

  return (
    <div className="space-y-1.5">
      {faixas.map((f) => (
        <div key={f.chave} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-right text-muted-foreground">{f.rotulo}</span>
          <div className="flex h-5 flex-1 overflow-hidden rounded bg-muted/40">
            <div className="flex h-full" style={{ width: `${(f.total / max) * 100}%` }}>
              {ORIGENS_CONFERENCIA.filter((o) => f.porOrigem[o] > 0).map((o) => (
                <div
                  key={o}
                  className={COR_ORIGEM[o]}
                  style={{ flexGrow: f.porOrigem[o], flexBasis: 0 }}
                  title={`${ORIGEM_CONFERENCIA_LABEL[o]}: ${f.porOrigem[o]}`}
                />
              ))}
            </div>
          </div>
          <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
            {f.total}
            {total > 0 && (
              <span className="ml-1 text-[10px]">
                ({Math.round((f.total / total) * 100)}%)
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function LinhaTooltip({
  origem,
  stat,
}: {
  origem: OrigemConferencia;
  stat: PeriodoConferencia["porOrigem"][OrigemConferencia];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-sm ${COR_ORIGEM[origem]}`} />
      <span className="text-muted-foreground">{ORIGEM_CONFERENCIA_LABEL[origem]}</span>
      <span className="ml-auto pl-3 font-medium tabular-nums">
        {stat.n === 0 ? "—" : `${fmtDuracaoSegundos(stat.medianaSegundos)} · ${stat.n}`}
      </span>
    </div>
  );
}

/**
 * Rótulos do eixo. Com muitos períodos (semanas de um ano inteiro) só um em cada
 * N aparece — o último sempre, porque é o que a pessoa foi olhar.
 */
function EixoPeriodos({ periodos }: { periodos: PeriodoConferencia[] }) {
  const passo = Math.ceil(periodos.length / 14);
  const ultimo = periodos.length - 1;

  return (
    <div className="mt-1.5 flex gap-1 sm:gap-1.5">
      {periodos.map((p, i) => (
        <div
          key={p.chave}
          className={`min-w-0 flex-1 truncate text-center text-[10px] tabular-nums ${
            i === ultimo ? "font-bold text-foreground" : "text-muted-foreground"
          }`}
        >
          {i === ultimo || i % passo === 0 ? p.rotulo : ""}
        </div>
      ))}
    </div>
  );
}

function Legenda({ origens }: { origens: OrigemConferencia[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
      {origens.map((o) => (
        <div key={o} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`h-2 w-2 shrink-0 rounded-sm ${COR_ORIGEM[o]}`} />
          {ORIGEM_CONFERENCIA_LABEL[o]}
        </div>
      ))}
    </div>
  );
}
