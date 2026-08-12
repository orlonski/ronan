"use client";

import { Button } from "@/components/ui/button";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP, ymdSaoPaulo } from "@/lib/datetime-br";

/**
 * Atalhos de período. O painel só tinha o default "primeiro dia do mês" — na
 * prática quem queria "mês passado" mexia em dois inputs de data toda vez.
 *
 * Todas as contas ancoram em America/Sao_Paulo (via datetime-br), nunca no fuso
 * do browser: em render no servidor o processo roda em UTC e, perto da virada,
 * "hoje" apontaria pro dia errado.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Data civil de SP em "YYYY-MM-DD". */
function ymdString(d: Date = new Date()): string {
  const [ano, mes, dia] = ymdSaoPaulo(d);
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

function diasAtras(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return ymdString(d);
}

function mesPassado(): { de: string; ate: string } {
  const [ano, mes] = ymdSaoPaulo();
  const anoAnterior = mes === 1 ? ano - 1 : ano;
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  // Dia 0 do mês seguinte = último dia do mês pedido (mesmo truque do
  // ultimoDiaDoMesSP).
  const ultimoDia = new Date(Date.UTC(anoAnterior, mesAnterior, 0)).getUTCDate();
  return {
    de: `${anoAnterior}-${pad(mesAnterior)}-01`,
    ate: `${anoAnterior}-${pad(mesAnterior)}-${pad(ultimoDia)}`,
  };
}

const PRESETS: { label: string; calcular: () => { de: string; ate: string } }[] = [
  { label: "Este mês", calcular: () => ({ de: primeiroDiaDoMesSP(), ate: ultimoDiaDoMesSP() }) },
  { label: "Mês passado", calcular: mesPassado },
  { label: "Últimos 30 dias", calcular: () => ({ de: diasAtras(29), ate: ymdString() }) },
  {
    label: "Este ano",
    calcular: () => {
      const [ano] = ymdSaoPaulo();
      return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
    },
  },
];

export function PeriodoPresets({
  de,
  ate,
  onChange,
}: {
  de?: string;
  ate?: string;
  onChange: (periodo: { de: string; ate: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((p) => {
        const alvo = p.calcular();
        const ativo = de === alvo.de && ate === alvo.ate;
        return (
          <Button
            key={p.label}
            type="button"
            size="sm"
            variant={ativo ? "outline" : "ghost"}
            className="h-8 text-xs"
            onClick={() => onChange(alvo)}
          >
            {p.label}
          </Button>
        );
      })}
    </div>
  );
}
