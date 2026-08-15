"use client";

import { ArrowDown, Calculator, Route, TrendingUp, User } from "lucide-react";
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
  // Faturado (após mínimo) — opcionais: o backend omite do payload pra quem
  // não tem `viagens.ver-comercial`, e aí o card mostra só calculado+informado.
  kmEfetivo?: string;
  kmAjustada?: boolean;
  kmReal: string | null; // GPS (tracking)
  rotaEscolhida?: boolean; // motorista escolheu outra rota no seletor
  kmRecalculadoEm: string | null;
  kmAntesRecalculo: string | null;
  temBotaFora: boolean;
  kmBotaFora: number;
  // Toneladas
  toneladasInformada: string;
  toneladasEfetiva?: string;
  toneladasAjustada?: boolean;
  // Regra de mínimo que casou
  regraMinimo?: RegraMinimo | null;
  /** Null quando o modo de serviço não exige material (diária à disposição). */
  materialNome: string | null;
};

/**
 * Conta a história do km/toneladas em tiles claros. O normal é o motorista
 * preencher e ser isso que fatura — então "Faturado/Faturadas" NÃO aparece
 * quando é igual ao informado (seria redundante). Ele só surge, destacado e
 * com o motivo, quando uma regra de mínimo por faixa ELEVOU o valor.
 * "Calculado (OSRM)" fica sempre pra comparar o km informado com a rota.
 */
export function FaturamentoCard(p: Props) {
  const calc = p.kmCalculado != null ? Number(p.kmCalculado) : null;
  const inf = Number(p.kmInformado);
  const diffRota = calc != null ? inf - calc : 0;
  const regra = p.regraMinimo;

  const seloMinimo = (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
      <TrendingUp className="h-3 w-3" /> elevado pelo mínimo
    </span>
  );

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-base font-medium">
        <TrendingUp className="h-4 w-4" /> Km e faturamento
      </h3>

      {/* --- KM --- (Faturado só quando o mínimo elevou) */}
      <div className={`grid gap-2 ${p.kmAjustada ? "grid-cols-3" : "grid-cols-2"}`}>
        <Tile
          Icon={Route}
          label="Calculado"
          hint="rota (OSRM)"
          valor={calc != null ? fmtNum(p.kmCalculado, 2) : "—"}
          unidade={calc != null ? "km" : undefined}
        />
        <Tile
          Icon={User}
          label={p.kmAjustada ? "Informado" : "Km da viagem"}
          hint="motorista"
          valor={fmtNum(p.kmInformado, 2)}
          unidade="km"
        />
        {p.kmAjustada && (
          <Tile
            Icon={ArrowDown}
            label="Faturado"
            hint="pelo mínimo"
            valor={fmtNum(p.kmEfetivo, 2)}
            unidade="km"
            destaque
            selo={seloMinimo}
          />
        )}
      </div>

      {/* Notas do km (explicam a diferença entre os tiles) */}
      <div className="mt-2 space-y-1">
        {p.kmRecalculadoEm && (
          <Nota tom="esmeralda">
            Km recalculado pelo trajeto real ao sincronizar
            {p.kmAntesRecalculo
              ? ` — de ${fmtNum(p.kmAntesRecalculo, 0)} → ${fmtNum(p.kmInformado, 0)} km`
              : ""}
          </Nota>
        )}
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
        {p.kmReal && (
          <Nota tom="cinza">
            Km real por GPS (tracking): {fmtNum(p.kmReal, 2)} km — só referência, não fatura.
          </Nota>
        )}
      </div>

      {/* Toneladas moveu pro strip do topo (ao lado do Ticket). Aqui fica só a
          regra de mínimo, que explica o faturado de km E de toneladas. */}

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
            {regra.materialEspecifico && p.materialNome
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

/** Mini-card quadrado: rótulo pequeno + número grande + unidade. */
function Tile({
  Icon,
  label,
  hint,
  valor,
  unidade,
  destaque,
  selo,
}: {
  Icon: typeof Route;
  label: string;
  hint?: string;
  valor: string;
  unidade?: string;
  destaque?: boolean;
  selo?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        destaque ? "border-primary/40 bg-primary/5" : "bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" /> {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-bold leading-none">{valor}</span>
        {unidade && <span className="text-xs text-muted-foreground">{unidade}</span>}
      </div>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
      {selo && <div className="mt-1.5">{selo}</div>}
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
  return <p className={`text-xs ${cor}`}>{children}</p>;
}

function faixaTexto(de: string, ate: string | null): string {
  const d = fmtNum(de, 0);
  return ate != null ? `Faixa de ${d} a ${fmtNum(ate, 0)} km` : `Faixa de ${d} km ou mais`;
}
