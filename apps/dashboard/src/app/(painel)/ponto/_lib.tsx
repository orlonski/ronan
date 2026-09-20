"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export const PATH = "/admin/ponto";

/** "-1h20" / "+8h05". O espelho é lido por gente, não por máquina. */
export function hm(min: number): string {
  const sinal = min < 0 ? "-" : min > 0 ? "+" : "";
  const abs = Math.abs(min);
  return `${sinal}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

/** Sem sinal: total trabalhado não é saldo. */
export function duracao(min: number): string {
  const abs = Math.abs(min);
  return `${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

export function diaBr(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

export type ConfigPonto = {
  contaId: string;
  razaoSocial: string;
  cnpj: string;
  fundamento: "ACORDO_COLETIVO" | null;
  fundamentoReferencia: string | null;
  diaFechamento: number;
  identificacaoRep: string;
  diasRetencaoLocalizacao: number;
  avisoLgpdTexto: string;
  mesesAcessoAposDesligamento: number;
};

export function useConfigPonto() {
  const token = useAuthToken();
  return useQuery({
    queryKey: [PATH, "config"],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigPonto>(`${PATH}/config`, { token }),
  });
}

/**
 * A tela que aparece ANTES de qualquer outra enquanto a empresa não disse por
 * que o controle dela vale.
 *
 * ⚠️ Não é burocracia nossa: controle eletrônico de jornada sem REP
 * certificado depende de previsão em convenção ou acordo coletivo. Deixar
 * operar sem isso seria a gente entregando uma ferramenta que o cliente não
 * pode usar — e ele só descobriria na fiscalização.
 *
 * ⚠️ O que ISSO NÃO BLOQUEIA: a marcação. O funcionário continua batendo o
 * ponto pelo app desde o primeiro dia. Quem espera é o escritório.
 */
export function PrecisaFundamento() {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-6">
      <p className="text-base font-semibold">Falta dizer por que o controle desta empresa vale</p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        O registro eletrônico de jornada por aplicativo, sem equipamento certificado, depende de
        previsão em convenção ou acordo coletivo da categoria. Informe qual é o acordo em{" "}
        <strong>Regras de ponto</strong> e as telas abrem.
      </p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Enquanto isso, quem é registrado <strong>já pode bater o ponto pelo app</strong> — o
        registro nunca fica travado por configuração nossa.
      </p>
    </div>
  );
}
