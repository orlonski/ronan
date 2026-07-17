"use client";

import { ArrowDown, Calculator, Route, TrendingUp, Truck, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fmtNum } from "@/lib/fechamento-helpers";

export type RegraMinimo = {
  kmFaixaDe: string;
  kmFaixaAte: string | null;
  kmMinimo: string | null;
  toneladasMinimo: string | null;
  materialEspecifico: boolean;
};

type Props = {
  // Km
  kmCalculado: string | null; // OSRM (rota)
  kmInformado: string; // o que o motorista lançou
  kmEfetivo: string; // faturado (após mínimo)
  kmAjustada: boolean; // mínimo elevou o km?
  kmReal: string | null; // GPS (tracking)
  rotaEscolhida?: boolean; // motorista escolheu outra rota no seletor
  kmRecalculadoEm: string | null;
  kmAntesRecalculo: string | null;
  temBotaFora: boolean;
  kmBotaFora: number;
  // Toneladas
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  // Regra de mínimo que casou
  regraMinimo: RegraMinimo | null;
  materialNome: string;
};

/**
 * Conta a história COMPLETA do km/toneladas faturados, em camadas claras:
 * calculado pela rota (OSRM) → informado pelo motorista → faturado (após o
 * mínimo por faixa). O admin vê de onde cada número veio sem adivinhar.
 */
export function FaturamentoCard(p: Props) {
  const calc = p.kmCalculado != null ? Number(p.kmCalculado) : null;
  const inf = Number(p.kmInformado);
  const diffRota = calc != null ? inf - calc : 0;
  const regra = p.regraMinimo;

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-base font-medium">
        <TrendingUp className="h-4 w-4" /> Km e faturamento
      </h3>

      {/* --- KM --- */}
      <div className="space-y-2.5">
        <Linha
          Icon={Route}
          label="Calculado pela rota"
          hint="o que o roteador (OSRM) estimou"
          valor={calc != null ? `${fmtNum(p.kmCalculado, 2)} km` : "—"}
        />
        {p.kmRecalculadoEm && (
          <Nota tom="esmeralda">
            Km recalculado pelo trajeto real ao sincronizar
            {p.kmAntesRecalculo
              ? ` — de ${fmtNum(p.kmAntesRecalculo, 0)} → ${fmtNum(p.kmInformado, 0)} km`
              : ""}
          </Nota>
        )}
        <Linha
          Icon={User}
          label="Informado pelo motorista"
          hint="o que ele confirmou no app"
          valor={`${fmtNum(p.kmInformado, 2)} km`}
        />
        {/* Só quando a diferença é real (>= 0,5 km) — abaixo disso é só
            arredondamento do snapshot, não um ajuste de verdade. */}
        {calc != null && Math.abs(diffRota) >= 0.5 && (
          <Nota tom={p.rotaEscolhida ? "ambar" : "cinza"}>
            {p.rotaEscolhida ? "Escolheu outra rota no mapa" : "Ajustou o km na mão"}:{" "}
            {diffRota > 0 ? "+" : ""}
            {fmtNum(String(diffRota), 1)} km vs. a rota calculada
          </Nota>
        )}
        {p.temBotaFora && (
          <Nota tom="ambar">
            Inclui a volta do bota-fora
            {p.kmBotaFora > 0 ? ` (+${fmtNum(String(p.kmBotaFora), 1)} km)` : ""}
          </Nota>
        )}

        {/* Faturado (destaque) */}
        <div className="mt-1 flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Km faturado</span>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold">{fmtNum(p.kmEfetivo, 2)} km</span>
            {p.kmAjustada && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                <TrendingUp className="h-3 w-3" /> elevado pelo mínimo
              </span>
            )}
          </div>
        </div>
        {p.kmReal && (
          <p className="text-xs text-muted-foreground">
            Km real por GPS (tracking): {fmtNum(p.kmReal, 2)} km — só referência, não fatura.
          </p>
        )}
      </div>

      {/* --- TONELADAS --- */}
      <div className="mt-5 space-y-2.5 border-t pt-4">
        <Linha
          Icon={Truck}
          label="Toneladas informadas"
          hint="o que o motorista lançou"
          valor={`${fmtNum(p.toneladasInformada, 3)} t`}
        />
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Toneladas faturadas</span>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold">{fmtNum(p.toneladasEfetiva, 3)} t</span>
            {p.toneladasAjustada && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                <TrendingUp className="h-3 w-3" /> elevado pelo mínimo
              </span>
            )}
          </div>
        </div>
      </div>

      {/* --- REGRA DE MÍNIMO --- */}
      {regra && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <Calculator className="h-4 w-4" /> Mínimo por faixa
          </div>
          <p className="text-sm text-amber-900">
            {faixaTexto(regra.kmFaixaDe, regra.kmFaixaAte)} ·{" "}
            {[
              regra.kmMinimo != null ? `mínimo ${fmtNum(regra.kmMinimo, 0)} km` : null,
              regra.toneladasMinimo != null
                ? `mínimo ${fmtNum(regra.toneladasMinimo, 3)} t`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            {regra.materialEspecifico
              ? `Regra específica de ${p.materialNome}`
              : "Regra de qualquer material desta empresa"}
            {p.kmAjustada || p.toneladasAjustada
              ? " — o real ficou abaixo, então fatura pelo mínimo."
              : " — o real ficou acima do mínimo, fatura o real."}
          </p>
        </div>
      )}
    </Card>
  );
}

function Linha({
  Icon,
  label,
  hint,
  valor,
}: {
  Icon: typeof Route;
  label: string;
  hint?: string;
  valor: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm">{label}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <span className="whitespace-nowrap text-sm font-medium">{valor}</span>
    </div>
  );
}

function Nota({
  children,
  tom,
}: {
  children: React.ReactNode;
  tom: "ambar" | "esmeralda" | "cinza";
}) {
  const cor =
    tom === "ambar"
      ? "text-amber-700"
      : tom === "esmeralda"
        ? "text-emerald-700"
        : "text-muted-foreground";
  return <p className={`ml-6 text-xs ${cor}`}>{children}</p>;
}

function faixaTexto(de: string, ate: string | null): string {
  const d = fmtNum(de, 0);
  return ate != null ? `Faixa de ${d} a ${fmtNum(ate, 0)} km` : `Faixa de ${d} km ou mais`;
}
